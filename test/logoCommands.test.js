const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const sharp = require("sharp");
const { generateTextLogo } = require("../RICHK-MD-core/textLogo");

const registered = [];
const pluginPath = require.resolve("../RICHK-MD-commands/logo");
const originalLoad = Module._load;
let requests = [], requestHandler;
Module._load = function(request, parent, isMain) {
    if (parent?.filename === pluginPath) {
        if (request === "../RICHK-MD-core") {
            return { gmd: (metadata, handler) => registered.push({ metadata, handler }) };
        }
        if (request === "axios") return { get: async (...args) => {
            requests.push(args);
            return requestHandler(...args);
        } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try { require(pluginPath); } finally { Module._load = originalLoad; }

const find = name => registered.find(({ metadata }) =>
    metadata.pattern === name || metadata.aliases?.includes(name));
function context(q = "RICH K MD", overrides = {}) {
    const sent = [], replies = [];
    return {
        sent, replies,
        socket: { sendMessage: async (...args) => sent.push(args) },
        input: {
            q, botCaption: "RICHK-MD", botName: "RICHK-MD", botPrefix: "!",
            mek: { key: { id: "test" } },
            reply: async text => replies.push(text),
            react: async () => {},
            ...overrides,
        },
    };
}

test(".logo and logo-maker aliases generate an actual PNG in the current chat without an API", async () => {
    requests = [];
    const entry = find("logo");
    for (const name of ["logomaker", "makelogo", "logomake"]) assert.equal(find(name), entry);
    const c = context();
    await entry.handler("current-chat@g.us", c.socket, c.input);
    assert.equal(c.sent.length, 1);
    assert.equal(c.sent[0][0], "current-chat@g.us");
    assert.equal(c.sent[0][2].quoted, c.input.mek);
    const meta = await sharp(c.sent[0][1].image).metadata();
    assert.equal(meta.format, "png");
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 1024);
    assert.match(c.sent[0][1].caption, /RICH K MD/);
    assert.deepEqual(requests, []);
});

test(".logo shows types without text, and validates overlong text", async () => {
    for (const text of ["", " ", "x".repeat(81)]) {
        const c = context(text);
        await find("logo").handler("chat", c.socket, c.input);
        assert.equal(c.sent.length, 0);
        assert.equal(c.replies.length, 1);
        assert.match(c.replies[0], text.trim() ? /80 characters/ : /LOGO TYPES/);
    }
});

test("logo renderer safely handles XML characters, multiline input, Unicode and maximum-length names", async () => {
    for (const text of ['R & K <Brand> "Logo"', "Café\nAccra", "W".repeat(80)]) {
        const buffer = await generateTextLogo(text);
        const stats = await sharp(buffer).stats();
        assert.ok(stats.entropy > 1);
    }
    await assert.rejects(generateTextLogo("\u0000\n\t"), /provide text/);
});

test("failed reactions cannot prevent the generated logo from being sent", async () => {
    const c = context("Brand", { react: async () => { throw new Error("Reaction unavailable"); } });
    await find("logo").handler("chat", c.socket, c.input);
    assert.equal(c.sent.length, 1);
    assert.equal(c.replies.length, 0);
});

test("failed image delivery produces a readable error instead of reporting success", async () => {
    const c = context();
    c.socket.sendMessage = async () => { throw new Error("Synthetic delivery failure"); };
    await find("logo").handler("chat", c.socket, c.input);
    assert.match(c.replies[0], /Could not create or send/);
});

test("specialty-service failures recommend the working local command without pretending to generate that effect", async () => {
    requests = [];
    requestHandler = async () => { throw new Error("Synthetic service timeout"); };
    const c = context("Brand");
    await find("luxurygold").handler("chat", c.socket, c.input);
    assert.equal(c.sent.length, 0);
    assert.match(c.replies[0], /service is unavailable.*!logo Brand/);
    assert.equal(requests[0][1].timeout, 20000);
});

test("specialty styles still download and deliver a valid provider result", async () => {
    const png = await generateTextLogo("Provider");
    requestHandler = async (_url, opts) => opts.responseType === "arraybuffer"
        ? { data: png }
        : { data: { success: true, result: { image_url: "https://images.example/logo.png" } } };
    const c = context("Brand");
    await find("luxurygold").handler("chat", c.socket, c.input);
    assert.equal(c.sent.length, 1);
    assert.ok(c.sent[0][1].image.equals(png));
});

test("logo menus stay separate from generation and use the configured prefix", async () => {
    const c = context("");
    await find("logolist").handler("chat", c.socket, c.input);
    assert.notEqual(find("logo"), find("logolist"));
    for (const alias of ["logos", "logohelp", "logomenu"]) assert.equal(find(alias), find("logolist"));
    assert.match(c.replies[0], /!logo 1 RICH K MD/);
    assert.match(c.replies[0], /Specialty types depend on the image service/);
    assert.equal(c.sent.length, 0);
    const names = registered.flatMap(({ metadata }) => [metadata.pattern, ...metadata.aliases]);
    assert.equal(names.length, new Set(names).size, "no alias may shadow another logo command");
});

test("a numbered menu choice generates the selected local logo with the supplied text", async () => {
    requests = [];
    const c = context("1 MY BRAND");
    await find("logo").handler("current-chat", c.socket, c.input);
    assert.equal(c.sent.length, 1);
    assert.match(c.sent[0][1].caption, /Text:\* MY BRAND/);
    assert.doesNotMatch(c.sent[0][1].caption, /Text:\* 1 MY BRAND/);
    assert.equal((await sharp(c.sent[0][1].image).metadata()).format, "png");
    assert.equal(requests.length, 0);
});

test("selecting a type alone asks for text without starting generation", async () => {
    for (const selection of ["1", "2", "glossysilver", "!silverlogo"]) {
        requests = [];
        const c = context(selection);
        await find("logo").handler("chat", c.socket, c.input);
        assert.equal(c.sent.length, 0);
        assert.equal(requests.length, 0);
        assert.match(c.replies[0], /Now add your logo text/);
        assert.match(c.replies[0], /!logo [12] <text>/);
    }
});

test("invalid logo numbers explain how to find valid types", async () => {
    for (const selection of ["0 Brand", "999 Brand"]) {
        const c = context(selection);
        await find("logo").handler("chat", c.socket, c.input);
        assert.equal(c.sent.length, 0);
        assert.match(c.replies[0], /Choose a logo type from 1 to/);
        assert.match(c.replies[0], /!logo to see the types/);
    }
});

test("numbered choices, style names and prefixed aliases dispatch the selected specialty generator", async () => {
    const png = await generateTextLogo("Provider");
    for (const selection of ["2 MY BRAND", "glossysilver MY BRAND", "!silverlogo MY BRAND"]) {
        requests = [];
        requestHandler = async (_url, opts) => opts.responseType === "arraybuffer"
            ? { data: png }
            : { data: { success: true, result: { image_url: "https://images.example/logo.png" } } };
        const c = context(selection, { GiftedTechApi: "https://api.example" });
        await find("logo").handler("chat", c.socket, c.input);
        assert.equal(c.sent.length, 1);
        assert.equal(requests[0][0], "https://api.example/api/ephoto360/glossysilver");
        assert.equal(requests[0][1].params.text, "MY BRAND");
        assert.match(c.sent[0][1].caption, /Glossy Silver/);
    }
});
