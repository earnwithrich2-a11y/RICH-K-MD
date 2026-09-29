const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dispatcherSource = fs.readFileSync(
    path.join(projectRoot, "index.js"),
    "utf8",
);
const helperSource = fs.readFileSync(
    path.join(projectRoot, "RICHK-MD-core/connection/commandHandler.js"),
    "utf8",
);
const settingsSource = fs.readFileSync(
    path.join(projectRoot, "RICHK-MD-core/database/settings.js"),
    "utf8",
);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);

    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
    return source.slice(start, end);
}

test("dispatcher reactions do not block command execution", () => {
    const handler = sourceBetween(
        dispatcherSource,
        "function setupCommandHandler(Gifted)",
        "function setupGiftedHelpers(Gifted, from)",
    );
    const reactionHelper = sourceBetween(
        handler,
        "const startCommandReaction = () =>",
        "const botPausedBeforeChecks",
    );

    assert.match(reactionHelper, /void\s+Gifted\.sendMessage\s*\(/);
    assert.match(reactionHelper, /sendMessage\(ms\.key\.remoteJid\s*\|\|\s*from/);
    assert.doesNotMatch(reactionHelper, /\bawait\b/);
    assert.doesNotMatch(handler, /await\s+startCommandReaction\s*\(/);
    assert.match(handler, /await\s+gmd\.function\s*\(/);
});

test("group and owner lookups remain concurrent", () => {
    const handler = sourceBetween(
        dispatcherSource,
        "function setupCommandHandler(Gifted)",
        "function setupGiftedHelpers(Gifted, from)",
    );

    assert.match(
        handler,
        /const\s+\[groupData,\s*superUser\]\s*=\s*await\s+Promise\.all\s*\(\s*\[\s*getGroupInfo\s*\([\s\S]*?buildSuperUsers\s*\(/,
    );
    assert.doesNotMatch(
        handler,
        /await\s+getGroupInfo\s*\([\s\S]*?await\s+buildSuperUsers\s*\(/,
    );
});

test("plugin reaction helper remains non-blocking", () => {
    const helper = sourceBetween(
        helperSource,
        "const react = (emoji) =>",
        "const edit = async",
    );

    assert.match(helper, /void\s+Gifted\.sendMessage\s*\(/);
    assert.match(helper, /sendMessage\(ms\.key\.remoteJid\s*\|\|\s*from/);
    assert.match(helper, /\.catch\s*\(/);
    assert.doesNotMatch(helper, /\bawait\b/);
    assert.doesNotMatch(helper, /const\s+react\s*=\s*async\b/);
});

test("view-once reveals use a private recipient rather than the current group", () => {
    const ownerSource = fs.readFileSync(
        path.join(projectRoot, "RICHK-MD-commands/owner.js"),
        "utf8",
    );
    const viewOnceHandler = sourceBetween(
        ownerSource,
        'pattern: "vv",',
        'pattern: "disapp",',
    );
    assert.match(
        viewOnceHandler,
        /const destination = await resolvePrivateRecipient\s*\(/,
    );
    assert.match(viewOnceHandler, /if \(!destination\) return reply\(/);
    assert.match(viewOnceHandler, /await Gifted\.sendMessage\(destination, msg\);/);
});

test("reply helpers return their send promise so awaited replies finish", () => {
    const replyHelper = sourceBetween(
        helperSource,
        "const reply = (text) =>",
        "const react = (emoji) =>",
    );
    assert.match(replyHelper, /const sent = Gifted\.sendMessage\s*\(/);
    assert.match(replyHelper, /return sent;/);
    assert.match(replyHelper, /sent\.catch\s*\(/);
});

test("private-mode access checks run before restricted reactions", () => {
    const handler = sourceBetween(
        dispatcherSource,
        "function setupCommandHandler(Gifted)",
        "function setupGiftedHelpers(Gifted, from)",
    );
    const immediatePolicy = sourceBetween(
        handler,
        "const canReactImmediately",
        "if (canReactImmediately) startCommandReaction();",
    );
    const deferredPolicy = sourceBetween(
        handler,
        "const commandAllowed",
        "if (commandAllowed && !canReactImmediately) startCommandReaction();",
    );

    assert.match(
        immediatePolicy,
        /MODE\?\.\s*toLowerCase\(\)\s*!==\s*"private"\s*\|\|\s*ms\.key\.fromMe/,
    );
    assert.match(deferredPolicy, /MODE\?\.\s*toLowerCase\(\)\s*===\s*"private"/);
    assert.match(deferredPolicy, /!isSuperUser/);

    const superUserCheck = handler.indexOf(
        "const isSuperUser = superUser.includes(sender);",
    );
    const deferredReaction = handler.indexOf(
        "if (commandAllowed && !canReactImmediately) startCommandReaction();",
    );
    assert.ok(
        superUserCheck < deferredReaction,
        "Super-user access must be resolved before a private-mode reaction",
    );
});

test("auto-block and read receipts do not delay command handlers", () => {
    const handler = sourceBetween(
        dispatcherSource,
        "function setupCommandHandler(Gifted)",
        "function setupGiftedHelpers(Gifted, from)",
    );

    assert.match(handler, /void\s+Gifted\.updateBlockStatus\s*\(/);
    assert.doesNotMatch(handler, /await\s+Gifted\.updateBlockStatus\s*\(/);
    assert.match(handler, /void\s+Gifted\.readMessages\s*\(/);
    assert.doesNotMatch(handler, /await\s+Gifted\.readMessages\s*\(/);
    assert.match(handler, /void\s+Gifted\.updateBlockStatus[\s\S]*?return;/);
});

test("dispatcher safely distinguishes placeholders from parsed commands", () => {
    const handler = sourceBetween(
        dispatcherSource,
        "function setupCommandHandler(Gifted)",
        "function setupGiftedHelpers(Gifted, from)",
    );
    const noContentBranch = sourceBetween(
        handler,
        "if (!ms.message) {",
        'if (type === "append" && !ms.key.fromMe)',
    );

    assert.match(noContentBranch, /ms\.messageStubType/);
    assert.match(noContentBranch, /Message arrived without decrypted content/);
    assert.doesNotMatch(noContentBranch, /ms\.key\.id|ms\.message\./);
    assert.match(
        handler,
        /Command text decrypted; registered handler \$\{gmd \? "found" : "not found"\}/,
    );
});

test("command settings reads use a short cache and writes invalidate it", () => {
    assert.match(settingsSource, /ALL_SETTINGS_CACHE_TTL_MS\s*=\s*1000/);
    assert.match(
        settingsSource,
        /async function setSetting[\s\S]*?allSettingsCache\s*=\s*null;[\s\S]*?allSettingsCacheExpiresAt\s*=\s*0;/,
    );
    assert.match(
        settingsSource,
        /async function getAllSettings[\s\S]*?Date\.now\(\)\s*<\s*allSettingsCacheExpiresAt[\s\S]*?SettingsDB\.findAll/,
    );
});