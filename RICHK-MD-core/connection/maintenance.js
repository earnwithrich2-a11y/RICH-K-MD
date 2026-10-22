const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");
const { standardizeJid } = require("./serializer");

const execute = promisify(execFile);
const DENIED = "⛔ Only the bot owner can use this command.";
const TEXT = {
    restart: "🔄 *Restarting RICH-K-MD...* Please wait ~10 seconds.",
    checking: "🔍 Checking RICH-K-MD servers for updates...",
    current: "✅ RICH-K-MD is up to date!",
    updating: "📥 Installing latest version...",
    unavailable: "❌ Updates are unavailable right now. Please contact the bot owner.",
    unsafe: "❌ This update cannot be installed safely right now. Please contact the bot owner.",
    failed: "❌ The update could not be completed. Please try again later.",
};

function identity(value) {
    const text = String(value || "").trim();
    return standardizeJid(text.includes("@") ? text : text.replace(/\D/g, ""));
}

async function isMaintenanceOwner(socket, context) {
    if ((context.m || context.mek)?.key?.fromMe === true) return true;
    const sender = identity(context.sender);
    if (!sender) return false;
    const own = [context.ownerNumber, socket.user?.id, socket.user?.lid,
        socket.authState?.creds?.me?.id, socket.authState?.creds?.me?.lid];
    if (own.map(identity).filter(Boolean).includes(sender)) return true;
    if (String(context.sudoNumbers || "").split(",").map(identity).filter(Boolean).includes(sender)) return true;
    try {
        const stored = await context.getSudoNumbers?.() || [];
        return stored.map(identity).filter(Boolean).includes(sender);
    } catch {
        return false; // Never grant maintenance access when verification fails.
    }
}

class MaintenanceError extends Error {}

function protectedPath(name) {
    return /(^|\/)(?:sessions?|auth_state|auth_info_baileys)(\/|$)/i.test(name) ||
        /(^|\/)(?:\.env(?:\..*)?|creds\.json)$/i.test(name) ||
        /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm))?$/i.test(name);
}

function dependencyChange(before, after, names) {
    if (names.some(name => /^(?:package-lock\.json|npm-shrinkwrap\.json|\.npmrc|patches\/)/.test(name))) return true;
    const localInputs = [before, after].flatMap(pkg =>
        ["dependencies", "devDependencies", "optionalDependencies"].flatMap(key =>
            Object.values(pkg[key] || {}).filter(value => typeof value === "string" && value.startsWith("file:"))
                .map(value => value.replace(/^file:(?:\.\/)?/, "").replace(/\/$/, ""))));
    if (names.some(name => localInputs.some(location => name === location || name.startsWith(`${location}/`)))) return true;
    return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"]
        .some(key => JSON.stringify(before[key] || {}) !== JSON.stringify(after[key] || {})) ||
        ["preinstall", "install", "postinstall"].some(key => before.scripts?.[key] !== after.scripts?.[key]);
}

function createMaintenanceService({
    cwd = path.resolve(__dirname, "../.."), run = execute, delay = sleep,
    exit = code => process.exit(code), log = message => console.warn(message),
} = {}) {
    let busy = false;
    let pendingInstall = false;
    let stage = "";
    async function command(file, args) {
        stage = `${path.basename(file)} ${args[0]}`;
        const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", DANGEROUSLY_ALLOW_GIT: "1" };
        for (const name of Object.keys(env)) {
            if (name.startsWith("GIT_TRACE") || name === "GIT_CURL_VERBOSE") delete env[name];
        }
        const result = await run(file, args, {
            cwd, env, timeout: file === "git" ? 60000 : 240000,
            maxBuffer: 1024 * 1024, windowsHide: true,
        });
        return result.stdout || "";
    }
    async function restart(socket) {
        await delay(2000);
        await socket.prepareForMaintenanceRestart?.();
        socket.maintenanceRestarting = true;
        try {
            // end(), unlike logout(), closes transport without revoking the login.
            if (typeof socket.end === "function") await socket.end(new Error("Owner requested maintenance restart"));
            else if (typeof socket.ws?.close === "function") await socket.ws.close();
            else throw new Error("No socket close method");
        } catch {
            log("[Maintenance] Socket close failed; process exit will close the transport.");
        }
        await delay(100);
        exit(0);
    }
    async function install() {
        const npm = process.platform === "win32" ? "npm.cmd" : "npm";
        const registry = await command(npm, ["config", "get", "registry"]);
        const proxy = registry.includes("package-firewall.replit.internal");
        if (proxy) await command(process.execPath, ["scripts/portable-lockfile.js", "--replit"]);
        try {
            await command(npm, ["install", "--no-audit", "--no-fund"]);
        } finally {
            if (proxy) await command(process.execPath, ["scripts/portable-lockfile.js"]);
        }
    }
    async function update(socket, context) {
        await context.reply(TEXT.checking);
        let top;
        try { top = (await command("git", ["rev-parse", "--show-toplevel"])).trim(); }
        catch { throw new MaintenanceError(TEXT.unavailable); }
        if (path.resolve(top) !== path.resolve(cwd)) throw new MaintenanceError(TEXT.unsafe);
        if ((await command("git", ["branch", "--show-current"])).trim() !== "main") {
            throw new MaintenanceError(TEXT.unsafe);
        }
        if ((await command("git", ["status", "--porcelain", "--untracked-files=no"])).trim()) {
            throw new MaintenanceError(TEXT.unsafe);
        }
        const before = (await command("git", ["rev-parse", "HEAD"])).trim();
        await command("git", ["fetch", "origin", "main"]);
        const target = (await command("git", ["rev-parse", "FETCH_HEAD"])).trim();
        if (before === target && !pendingInstall) return context.reply(TEXT.current);
        if (before !== target) {
            await command("git", ["merge-base", "--is-ancestor", before, target]);
            const names = (await command("git", ["diff", "--name-only", "--no-renames", "-z", before, target]))
                .split("\0").filter(Boolean);
            if (names.some(protectedPath)) throw new MaintenanceError(TEXT.unsafe);
            const oldPackage = JSON.parse(await command("git", ["show", `${before}:package.json`]));
            const newPackage = JSON.parse(await command("git", ["show", `${target}:package.json`]));
            const needsInstall = dependencyChange(oldPackage, newPackage, names);
            // Merge the exact inspected commit; never reset, clean or fetch again
            // during pull, which could introduce uninspected credential changes.
            await command("git", ["merge", "--ff-only", target]);
            pendingInstall ||= needsInstall;
        }
        await context.reply(TEXT.updating);
        if (pendingInstall) {
            await install();
            pendingInstall = false;
        }
        await restart(socket);
    }
    return {
        async run(action, socket, context) {
            if (!await isMaintenanceOwner(socket, context)) return context.reply(DENIED);
            if (busy) return context.reply("⏳ An update or restart is already in progress. Please wait.");
            busy = true;
            try {
                if (action === "restart") {
                    await context.reply(TEXT.restart);
                    await restart(socket);
                } else if (action === "update") await update(socket, context);
                else throw new MaintenanceError("❌ Unknown maintenance command.");
            } catch (error) {
                log(`[Maintenance] ${action} failed during ${stage || "restart preparation"}.`);
                await context.reply(error instanceof MaintenanceError ? error.message :
                    action === "update" ? TEXT.failed : "❌ Restart could not be completed. Please try again later.");
            } finally { busy = false; }
        },
    };
}

const maintenance = createMaintenanceService();
module.exports = { maintenance, createMaintenanceService, isMaintenanceOwner, protectedPath, dependencyChange, TEXT, DENIED };
