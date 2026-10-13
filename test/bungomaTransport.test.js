const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sdk = require("gifted-baileys");
const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
const { createTransportLogger } = require("../RICHK-MD-core/connection/transportLogger");
const source = fs.readFileSync(require.resolve("@whiskeysockets/baileys/lib/Socket/messages-recv"), "utf8");

function receiptHandler(context) {
    const start = source.indexOf("const handleReceipt =");
    const end = source.indexOf("const handleNotification =", start);
    return vm.runInNewContext(`${source.slice(start, end)}; handleReceipt`, {
        config: { prioritizeLiveMessages: true }, logger,
        authState: { creds: { me: { id: "15550000001:4@s.whatsapp.net", lid: "99880001:4@lid" } } },
        WABinary_1: sdk, Utils_1: { getStatusFromReceiptType: () => undefined },
        WAProto_1: { proto: sdk.proto }, ev: { emit() {} },
        shouldIgnoreJid: () => false, willSendMessageAgain: () => true,
        receiptMutex: { mutex: work => work() },
        ...context,
    });
}

test("retry error diagnostics emit only fixed categories, never arbitrary trace contents", () => {
    const lines = [];
    createTransportLogger(line => lines.push(line)).error({
        trace: "TypeError: arbitrary private material must never appear",
    }, "error in sending message again");
    assert.deepEqual(lines, ["[WhatsApp] Retry resend failed. Category: TRANSPORT_TYPE_ERROR"]);
});

test("device discovery preserves namespaces and excludes both aliases of the sending device", () => {
    const devices = sdk.extractDeviceJids([
        { id: "15550000001@s.whatsapp.net", devices: { deviceList: [{ id: 0 }, { id: 4, keyIndex: 1 }] } },
        { id: "99880001@lid", devices: { deviceList: [{ id: 4, keyIndex: 1 }] } },
        { id: "15550000002@s.whatsapp.net", devices: { deviceList: [{ id: 0 }, { id: 99, keyIndex: 1 }] } },
        { id: "99880002@lid", devices: { deviceList: [{ id: 7, keyIndex: 1 }] } },
        { id: "99880003@hosted.lid", devices: { deviceList: [{ id: 99, keyIndex: 1 }] } },
    ], "15550000001:4@s.whatsapp.net", false, "99880001:4@lid");
    assert.deepEqual(devices.map(({ user, device, server }) => `${user}:${device}@${server}`), [
        "15550000001:0@s.whatsapp.net", "15550000002:0@s.whatsapp.net", "99880002:7@lid", "99880003:99@hosted.lid",
    ]);
});

test("a slow resend is acknowledged once and never occupies incoming command processing", async () => {
    let release, entered, acknowledgements = 0, liveLocks = 0;
    const waiting = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const handle = receiptHandler({
        sendMessageAck: async () => { acknowledgements++; },
        processingMutex: { mutex() { liveLocks++; throw new Error("Incoming queue used"); } },
        sendMessagesAgain: async () => { entered(); await waiting; },
    });
    const pending = handle({
        tag: "receipt", attrs: { from: "15550000002:7@s.whatsapp.net", id: "synthetic", type: "retry" },
        content: [{ tag: "retry", attrs: { count: "1" } }],
    });
    await started;
    assert.equal(acknowledgements, 1);
    assert.equal(liveLocks, 0);
    release();
    await pending;
    assert.equal(acknowledgements, 1, "the finalizer must not send a duplicate acknowledgement");
});

test("missing retry payloads cannot reset recipient sessions or publish any reply", async () => {
    const start = source.indexOf("const sendMessagesAgain =");
    const end = source.indexOf("const handleReceipt =", start);
    const fail = () => { throw new Error("Missing payload caused a crypto or send operation"); };
    const resend = vm.runInNewContext(`${source.slice(start, end)}; sendMessagesAgain`, {
        getMessage: async () => undefined, assertSessions: fail,
        signalRepository: { injectE2ESession: fail },
        authState: { keys: { set: fail } }, relayMessage: fail,
    });
    await resend({ remoteJid: "15550000002@s.whatsapp.net" }, ["synthetic"], {}, {});
});
