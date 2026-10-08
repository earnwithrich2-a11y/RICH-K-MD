const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const binary = require("gifted-baileys/lib/WABinary");
const { makeMutex } = require("gifted-baileys/lib/Utils/make-mutex");

const source = fs.readFileSync(require.resolve("gifted-baileys/lib/Socket/messages-recv"), "utf8");
const drain = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function receiptHarness(prioritizeLiveMessages = true) {
    const start = source.indexOf("const handleReceipt = async ");
    const end = source.indexOf("const handleNotification =", start);
    assert.ok(start >= 0 && end > start);
    const resends = [], acks = [];
    const processingMutex = makeMutex();
    const context = {
        processingMutex,
        config: { prioritizeLiveMessages },
        require: createRequire(require.resolve("gifted-baileys/lib/Socket/messages-recv")),
        authState: { creds: { me: { id: "10001:9@s.whatsapp.net", lid: "20001:9@lid" } } },
        WABinary_1: binary,
        WAProto_1: { proto: { WebMessageInfo: { Status: { SERVER_ACK: 2, DELIVERY_ACK: 3 } } } },
        Utils_1: { getStatusFromReceiptType: () => undefined },
        shouldIgnoreJid: () => false,
        ev: { emit() {} },
        logger: { debug() {}, info() {}, error() {} },
        willSendMessageAgain: () => true,
        sendMessagesAgain: async (key, ids) => {
            const pending = deferred();
            resends.push({ participant: key.participant, ids, pending });
            await pending.promise;
        },
        sendMessageAck: async node => { acks.push(node.attrs.id); },
    };
    vm.createContext(context);
    const factoryStart = source.indexOf("const receiptProcessingMutex = ");
    const factoryEnd = source.indexOf("const sendMessageAck = ", factoryStart);
    assert.ok(factoryStart >= 0 && factoryEnd > factoryStart);
    vm.runInContext(source.slice(factoryStart, factoryEnd), context);
    vm.runInContext(source.slice(start, end) + "\nthis.receive = handleReceipt;", context);
    return { context, processingMutex, resends, acks };
}

const receipt = (id, device = 2) => ({
    tag: "receipt",
    attrs: { id, from: `20001:${device}@lid`, type: "retry" },
    content: [{ tag: "retry", attrs: { count: "1" } }],
});

test("a held retry resend is acknowledged once and cannot occupy incoming processing", async () => {
    const h = receiptHarness();
    const pending = h.context.receive(receipt("old-retry"));
    await drain();
    assert.equal(h.resends.length, 1);
    assert.deepEqual(h.acks, ["old-retry"]);
    let incomingProcessed = false;
    await h.processingMutex.mutex(async () => { incomingProcessed = true; });
    assert.equal(incomingProcessed, true);
    h.resends[0].pending.resolve();
    await pending;
    assert.deepEqual(h.acks, ["old-retry"]);
});

test("retries stay ordered per device without blocking a different device", async () => {
    const h = receiptHarness();
    const first = h.context.receive(receipt("first", 2));
    const second = h.context.receive(receipt("second", 2));
    const primary = h.context.receive(receipt("primary", 0));
    await drain();
    assert.deepEqual(h.resends.map(r => r.ids[0]), ["first", "primary"]);
    assert.equal(h.acks.length, 3);
    h.resends[0].pending.resolve();
    h.resends[1].pending.resolve();
    await Promise.all([first, primary]);
    await drain();
    assert.equal(h.resends[2].ids[0], "second");
    h.resends[2].pending.resolve();
    await second;
    assert.equal(h.acks.length, 3);
});

test("SDK default retains serialized receipts and acknowledges after retry processing", async () => {
    const h = receiptHarness(false);
    const pending = h.context.receive(receipt("legacy"));
    await drain();
    assert.equal(h.acks.length, 0);
    let incomingProcessed = false;
    const incoming = h.processingMutex.mutex(async () => { incomingProcessed = true; });
    await drain();
    assert.equal(incomingProcessed, false);
    h.resends[0].pending.resolve();
    await Promise.all([pending, incoming]);
    assert.equal(incomingProcessed, true);
    assert.deepEqual(h.acks, ["legacy"]);
});

test("offline receipts bypass the historical queue, but messages and notifications retain order", () => {
    const start = source.indexOf("const processNode = ");
    const end = source.indexOf("// Handles newsletter notifications", start);
    assert.ok(start >= 0 && end > start);
    const offline = [], direct = [];
    const context = {
        config: { prioritizeLiveMessages: true },
        offlineNodeProcessor: { enqueue: (type, node) => offline.push(type) },
        processNodeWithBuffer: (node, name) => direct.push(name),
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\nthis.dispatch = processNode;", context);
    const node = { attrs: { offline: "1" } };
    context.dispatch("receipt", node, "retry", () => {});
    context.dispatch("notification", node, "notification", () => {});
    context.dispatch("message", node, "message", () => {});
    assert.deepEqual(direct, ["retry"]);
    assert.deepEqual(offline, ["notification", "message"]);
    context.config = {};
    context.dispatch("receipt", node, "legacy", () => {});
    assert.deepEqual(offline, ["notification", "message", "receipt"]);
});

test("one failed offline packet cannot latch the queue and discard later messages", async () => {
    const start = source.indexOf("const makeOfflineNodeProcessor = ");
    const end = source.indexOf("const offlineNodeProcessor = ", start);
    assert.ok(start >= 0 && end > start);
    const processed = [], errors = [];
    const context = {
        ws: { isOpen: true },
        handleMessage: async node => {
            processed.push(node.id);
            if (node.id === "malformed") throw new Error("synthetic decoding error");
        },
        handleReceipt: async () => {}, handleNotification: async () => {}, handleCall: async () => {},
        onUnexpectedError: error => errors.push(error.message),
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + "\nthis.queue = makeOfflineNodeProcessor();", context);
    context.queue.enqueue("message", { id: "malformed" });
    context.queue.enqueue("message", { id: "next" });
    await drain();
    assert.deepEqual(processed, ["malformed", "next"]);
    assert.equal(errors.length, 1);
    context.queue.enqueue("message", { id: "later" });
    await drain();
    assert.deepEqual(processed, ["malformed", "next", "later"]);
});
