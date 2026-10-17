"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

test("real plugin modules load and register reachable commands without network access", (t) => {
    const childScript = String.raw`
        const fs = require("node:fs");
        const path = require("node:path");
        const http = require("node:http");
        const https = require("node:https");
        const net = require("node:net");
        const tls = require("node:tls");
        const Module = require("node:module");

        const noNetwork = () => {
            throw new Error("Network access is disabled in the command registry test");
        };
        http.request = noNetwork;
        http.get = noNetwork;
        https.request = noNetwork;
        https.get = noNetwork;
        net.connect = noNetwork;
        net.createConnection = noNetwork;
        tls.connect = noNetwork;
        global.fetch = noNetwork;

        const root = process.argv[1];
        const pluginsDir = path.join(root, "RICHK-MD-commands");
        const coreDir = path.join(root, "RICHK-MD-core");
        const { gmd, commands, evt } = require(path.join(coreDir, "gmdCmds"));
        const noSideEffects = new Proxy({ gmd, commands, evt }, {
            get(target, key) {
                if (key in target) return target[key];
                return () => undefined;
            }
        });

        // Exercise the actual registry and command loader, but replace plugin
        // imports of core services (database/session/WhatsApp helpers) with
        // inert exports. Plugin handlers are registered, never invoked.
        const originalLoad = Module._load;
        Module._load = function(request, parent, isMain) {
            if (parent && parent.filename.startsWith(pluginsDir + path.sep)) {
                let resolved;
                try {
                    resolved = Module._resolveFilename(request, parent);
                } catch (_) {
                    return originalLoad.call(this, request, parent, isMain);
                }
                if (resolved.startsWith(coreDir + path.sep) &&
                    path.basename(resolved) !== "gmdCmds.js") {
                    return noSideEffects;
                }
            }
            return originalLoad.call(this, request, parent, isMain);
        };

        const pluginFiles = fs.readdirSync(pluginsDir)
            .filter((name) => [".js", ".gmd", ".kasongo", ".amd", ".richk", ".ke"]
                .includes(path.extname(name).toLowerCase()))
            .sort();

        try {
            const { loadPlugins, findCommand } = require(path.join(
                root, "RICHK-MD-core", "connection", "commandHandler"
            ));
            const { commands } = require(path.join(root, "RICHK-MD-core", "gmdCmds"));
            loadPlugins(pluginsDir, { throwOnError: true });

            const unloadedPlugins = pluginFiles.filter((name) => {
                const filePath = require.resolve(path.join(pluginsDir, name));
                return !require.cache[filePath];
            });
            const metadataErrors = [];
            const lookupKeys = new Map();
            const addLookupKey = (key, commandIndex, kind) => {
                if (typeof key !== "string" || !key.trim()) {
                    metadataErrors.push("command " + commandIndex + " has an invalid " + kind);
                    return;
                }
                if (!lookupKeys.has(key)) lookupKeys.set(key, []);
                lookupKeys.get(key).push({ commandIndex, kind });
            };

            commands.forEach((command, index) => {
                if (!command || typeof command !== "object") {
                    metadataErrors.push("command " + index + " is not an object");
                    return;
                }
                if (typeof command.pattern !== "string" || !command.pattern.trim()) {
                    metadataErrors.push("command " + index + " has no non-empty string pattern");
                } else {
                    addLookupKey(command.pattern, index, "pattern");
                }
                if (typeof command.function !== "function") {
                    metadataErrors.push("command " + index + " (" + command.pattern + ") has no handler");
                }
                if (typeof command.category !== "string" || !command.category.trim()) {
                    metadataErrors.push("command " + index + " (" + command.pattern + ") has no category");
                }
                if (typeof command.react !== "string" || !command.react.trim()) {
                    metadataErrors.push("command " + index + " (" + command.pattern + ") has no reaction metadata");
                }
                if (typeof command.filename !== "string" || !command.filename.trim()) {
                    metadataErrors.push("command " + index + " (" + command.pattern + ") has no source filename");
                }
                if (command.aliases !== undefined) {
                    if (!Array.isArray(command.aliases)) {
                        metadataErrors.push("command " + index + " (" + command.pattern + ") aliases are not an array");
                    } else {
                        command.aliases.forEach((alias) => addLookupKey(alias, index, "alias"));
                    }
                }
            });

            const unreachable = [];
            for (const [key, owners] of lookupKeys) {
                const found = findCommand(key);
                if (!found || owners.some((owner) => found !== commands[owner.commandIndex])) {
                    unreachable.push(key);
                }
            }

            const collisions = Array.from(lookupKeys.entries())
                .filter(([, owners]) => owners.length > 1)
                .map(([key, owners]) => ({
                    key,
                    registrations: owners.map(({ commandIndex, kind }) => ({
                        command: commands[commandIndex].pattern,
                        kind,
                        filename: commands[commandIndex].filename
                    }))
                }));

            process.stdout.write("COMMAND_REGISTRY_RESULT:" + JSON.stringify({
                pluginCount: pluginFiles.length,
                unloadedPlugins,
                commandCount: commands.length,
                metadataErrors,
                unreachable,
                collisions
            }) + "\n");
        } catch (error) {
            process.stderr.write((error && error.stack) || String(error));
            process.exitCode = 1;
        }
    `;

    // An explicitly empty value prevents config.js from loading a real URL
    // from .env; the child replaces Sequelize with an in-memory instance.
    const child = spawnSync(process.execPath, ["-e", childScript, projectRoot], {
        cwd: projectRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, DATABASE_URL: "" },
    });

    assert.equal(child.error, undefined, child.error && child.error.message);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const resultLine = child.stdout.split(/\r?\n/).find((line) => line.startsWith("COMMAND_REGISTRY_RESULT:"));
    assert.ok(resultLine, "isolated loader did not return registry results: " + child.stdout);
    const result = JSON.parse(resultLine.slice("COMMAND_REGISTRY_RESULT:".length));

    assert.ok(result.pluginCount > 0, "expected real plugin modules to be discovered");
    assert.deepEqual(result.unloadedPlugins, [], "every discovered plugin module must load");
    assert.ok(result.commandCount > 0, "plugins must register commands");
    assert.deepEqual(result.metadataErrors, [], "registered commands must have required metadata");
    assert.deepEqual(result.unreachable, [], "every registered pattern and alias must resolve with findCommand");

    assert.deepEqual(result.collisions, [], "command names and aliases must be unique");
    t.diagnostic("Validated " + result.commandCount + " registered commands from " + result.pluginCount + " plugins");
});