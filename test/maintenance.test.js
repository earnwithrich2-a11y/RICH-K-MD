const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createMaintenanceService, isMaintenanceOwner, protectedPath, dependencyChange, TEXT, DENIED } =
    require("../RICHK-MD-core/connection/maintenance");
const { installBranding, runCommandOutput } = require("../RICHK-MD-core/branding");
const { supervise } = require("../scripts/run-bot");

function fixture(options = {}) {
    const events = [], replies = [], commands = [];
    const cwd = "/virtual/app";
    const oldPackage = { dependencies: { example: "1.0.0" }, scripts: { postinstall: "patch-package" } };
    const target = options.current ? "old" : "new";
    const socket = {
        user: { id: "15550000002:7@s.whatsapp.net", lid: "synthetic-own@lid" },
        prepareForMaintenanceRestart: async () => events.push("save"),
        end: async () => { assert.equal(socket.maintenanceRestarting, true); events.push("close"); },
        logout() { throw new Error("Logout must never be used"); },
    };
    const context = {
        m: { key: { fromMe: false } }, sender: "15550000001@s.whatsapp.net",
        ownerNumber: "15550000001", getSudoNumbers: async () => ["15550000003"],
        reply: async text => { replies.push(text); events.push(`reply:${text}`); },
    };
    const service = createMaintenanceService({
        cwd,
        async run(file, args, runOptions) {
            commands.push([file, args]);
            assert.equal(runOptions.cwd, cwd);
            assert.equal(runOptions.env.GIT_TERMINAL_PROMPT, "0");
            if (options.fail?.(file, args)) throw new Error("Synthetic failure");
            if (file === "git") {
                if (args[0] === "rev-parse") return { stdout: args[1] === "--show-toplevel" ? cwd : args[1] === "HEAD" ? "old" : target };
                if (args[0] === "branch") return { stdout: options.branch || "main" };
                if (args[0] === "status") return { stdout: options.dirty ? " M index.js" : "" };
                if (args[0] === "diff") return { stdout: (options.paths || ["index.js"]).join("\0") + "\0" };
                if (args[0] === "show") return { stdout: JSON.stringify(
                    args[1].startsWith("old:") ? oldPackage : options.newPackage || oldPackage,
                ) };
            }
            if (file === "npm" && args[0] === "config") return { stdout: options.proxy ? "http://package-firewall.replit.internal/npm/" : "https://registry.npmjs.org/" };
            return { stdout: "" };
        },
        delay: async ms => events.push(`wait:${ms}`),
        exit: code => events.push(`exit:${code}`),
        log: () => {},
    });
    return { service, socket, context, events, replies, commands };
}

test("only owner, connected number/fromMe and explicit sudo are authorized, never broad developer privileges", async () => {
    const f = fixture();
    for (const sender of ["15550000001@s.whatsapp.net", "15550000002@s.whatsapp.net", "synthetic-own@lid", "15550000003@s.whatsapp.net"]) {
        assert.equal(await isMaintenanceOwner(f.socket, { ...f.context, sender }), true);
    }
    assert.equal(await isMaintenanceOwner(f.socket, { ...f.context, sender: "15550000099@s.whatsapp.net", isSuperUser: true }), false);
    assert.equal(await isMaintenanceOwner(f.socket, { ...f.context, sender: "15550000099@s.whatsapp.net", m: { key: { fromMe: true } } }), true);
    assert.equal(await isMaintenanceOwner(f.socket, { ...f.context, sender: "15550000004@s.whatsapp.net", sudoNumbers: "+15550000004", getSudoNumbers: async () => { throw Error("offline"); } }), true);
    assert.equal(await isMaintenanceOwner(f.socket, { ...f.context, sender: "15550000099@s.whatsapp.net", getSudoNumbers: async () => { throw Error("offline"); } }), false);
});

for (const action of ["restart", "update"]) {
    test(`unauthorized ${action} sends the exact rejection and performs no operations`, async () => {
        const f = fixture();
        await f.service.run(action, f.socket, { ...f.context, sender: "15550000099@s.whatsapp.net", isSuperUser: true });
        assert.deepEqual(f.replies, [DENIED]);
        assert.equal(f.commands.length, 0);
        assert.equal(f.events.some(event => /wait:|close|exit:|save/.test(event)), false);
    });
}

test("restart awaits acknowledgement, waits two seconds, saves auth, closes transport and exits zero", async () => {
    const f = fixture();
    await f.service.run("restart", f.socket, f.context);
    assert.deepEqual(f.events, [`reply:${TEXT.restart}`, "wait:2000", "save", "close", "wait:100", "exit:0"]);
    assert.equal(f.commands.length, 0);
});

test("an acknowledgement or auth-save failure cannot terminate the bot", async () => {
    for (const failure of ["reply", "save"]) {
        const f = fixture();
        if (failure === "reply") {
            let first = true;
            f.context.reply = async () => { if (first) { first = false; throw Error("send failed"); } };
        } else f.socket.prepareForMaintenanceRestart = async () => { throw Error("save failed"); };
        await f.service.run("restart", f.socket, f.context);
        assert.equal(f.events.includes("close"), false);
        assert.equal(f.events.includes("exit:0"), false);
    }
});

test("up-to-date update replies exactly and neither installs nor restarts", async () => {
    const f = fixture({ current: true });
    await f.service.run("update", f.socket, f.context);
    assert.deepEqual(f.replies, [TEXT.checking, TEXT.current]);
    assert.equal(f.commands.some(([file]) => file === "npm"), false);
    assert.equal(f.events.includes("close"), false);
});

test("code-only update fetches and fast-forwards the inspected commit without installing", async () => {
    const f = fixture();
    await f.service.run("update", f.socket, f.context);
    assert.deepEqual(f.replies, [TEXT.checking, TEXT.updating]);
    assert.ok(f.commands.some(([file, args]) => file === "git" && args.join(" ") === "fetch origin main"));
    assert.ok(f.commands.some(([file, args]) => file === "git" && args.join(" ") === "merge --ff-only new"));
    assert.equal(f.commands.some(([file]) => file === "npm"), false);
    assert.equal(f.events.at(-1), "exit:0");
});

test("dependency updates install before restart; Replit registry conversion is restored", async () => {
    const f = fixture({ paths: ["package-lock.json"], proxy: true });
    await f.service.run("update", f.socket, f.context);
    const install = f.commands.findIndex(([file, args]) => file === "npm" && args[0] === "install");
    assert.ok(install > 0);
    assert.deepEqual(f.commands[install - 1][1], ["scripts/portable-lockfile.js", "--replit"]);
    assert.deepEqual(f.commands[install + 1][1], ["scripts/portable-lockfile.js"]);
    assert.equal(f.events.at(-1), "exit:0");
});

test("install failures keep the bot process and auth intact rather than claiming success", async () => {
    const f = fixture({ paths: ["package-lock.json"], fail: (file, args) => file === "npm" && args[0] === "install" });
    await f.service.run("update", f.socket, f.context);
    assert.equal(f.replies.at(-1), TEXT.failed);
    assert.equal(f.events.includes("save"), false);
    assert.equal(f.events.includes("close"), false);
    assert.equal(f.events.includes("exit:0"), false);
});

test("missing Git metadata, local changes, another branch or a divergent history refuse safely", async () => {
    for (const options of [
        { fail: (file, args) => file === "git" && args[0] === "rev-parse" },
        { dirty: true }, { branch: "feature" },
        { fail: (file, args) => file === "git" && args[0] === "merge-base" },
    ]) {
        const f = fixture(options);
        await f.service.run("update", f.socket, f.context);
        assert.match(f.replies.at(-1), /❌/);
        assert.equal(f.commands.some(([, args]) => args[0] === "merge"), false);
        assert.equal(f.events.includes("exit:0"), false);
    }
});

test("updates cannot introduce, change or remove session data or runtime databases", async () => {
    for (const name of ["RICHK-MD-core/session/creds.json", "sessions/auth.json", ".env", "RICHK-MD-core/database/database.db-wal"]) {
        assert.equal(protectedPath(name), true);
        const f = fixture({ paths: [name] });
        await f.service.run("update", f.socket, f.context);
        assert.equal(f.replies.at(-1), TEXT.unsafe);
        assert.equal(f.commands.some(([, args]) => args[0] === "merge"), false);
    }
    assert.equal(dependencyChange({}, { description: "changed" }, ["package.json"]), false);
    assert.equal(dependencyChange({}, { dependencies: { lib: "1.0.0" } }, ["package.json"]), true);
    const localPackage = { dependencies: { compatibility: "file:./local-compat" } };
    assert.equal(dependencyChange(localPackage, localPackage, ["local-compat/index.js"]), true);
});

test("simultaneous maintenance requests cannot overlap", async () => {
    const f = fixture();
    let release;
    f.context.reply = async text => {
        f.replies.push(text);
        if (text === TEXT.restart) await new Promise(resolve => { release = resolve; });
    };
    const running = f.service.run("restart", f.socket, f.context);
    await new Promise(resolve => setImmediate(resolve));
    await f.service.run("update", f.socket, f.context);
    assert.match(f.replies.at(-1), /already in progress/);
    assert.equal(f.commands.length, 0);
    release();
    await running;
});

test("update statuses use the requested wording and all update notices avoid technical details", async () => {
    assert.equal(TEXT.checking, "🔍 Checking RICH-K-MD servers for updates...");
    assert.equal(TEXT.updating, "📥 Installing latest version...");
    assert.equal(TEXT.current, "✅ RICH-K-MD is up to date!");
    for (const options of [
        {}, { current: true }, { dirty: true }, { branch: "feature" },
        { paths: ["RICHK-MD-core/session/creds.json"] },
        { fail: () => true },
        { paths: ["package-lock.json"], fail: (file, args) => file === "npm" && args[0] === "install" },
    ]) {
        const f = fixture(options);
        await f.service.run("update", f.socket, f.context);
        for (const reply of f.replies) {
            assert.doesNotMatch(reply, /github|\bgit\b|\bnpm\b|checkout|branch|commit|credential|database|redeploy|server logs|╭─|╰─/i);
        }
    }
});

test("maintenance replies keep the exact requested text rather than premium framing", async () => {
    const sent = [];
    const socket = { sendMessage: async (_jid, content) => sent.push(content), relayMessage: async () => {} };
    installBranding(socket);
    for (const command of ["restart", "update"]) {
        await runCommandOutput(command, {}, () => socket.sendMessage("chat", { text: DENIED }));
        assert.equal(sent.at(-1).text, DENIED);
    }
});

test("registered maintenance commands reject broad super-users through their actual plugin handlers", async () => {
    const { commands } = require("../RICHK-MD-core/gmdCmds");
    require("../RICHK-MD-commands/updater");
    for (const pattern of ["restart", "update"]) {
        const plugin = commands.find(command => command.pattern === pattern);
        assert.equal(plugin.maintenance, true);
        const f = fixture();
        await plugin.function("chat", f.socket, { ...f.context, sender: "15550000099@s.whatsapp.net", isSuperUser: true });
        assert.deepEqual(f.replies, [DENIED]);
        assert.equal(f.events.includes("exit:0"), false);
    }
});

test("supervisor respawns a clean exit but never respawns during intentional shutdown", () => {
    const children = [], schedules = [], exits = [];
    const runner = supervise({
        spawnChild: () => {
            const child = new EventEmitter();
            child.exitCode = null;
            child.kill = () => { child.exitCode = 0; child.emit("exit", 0); };
            children.push(child);
            return child;
        },
        schedule: (work, ms) => schedules.push({ work, ms }),
        exit: code => exits.push(code),
    });
    children[0].emit("exit", 0);
    assert.equal(schedules[0].ms, 1000);
    assert.equal(exits.length, 0);
    schedules[0].work();
    assert.equal(children.length, 2);
    runner.stop();
    assert.deepEqual(exits, [0]);
    assert.equal(schedules.length, 1);
});
