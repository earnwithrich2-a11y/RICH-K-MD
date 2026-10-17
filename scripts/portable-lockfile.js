const fs = require("node:fs");
const path = require("node:path");

// npm in Replit writes proxy-specific tarball URLs. Preserve the exact package
// versions and integrity hashes while making the lock usable outside Replit.
function makePortable(lock, forReplit = false) {
    let changed = 0;
    for (const entry of Object.values(lock.packages || {})) {
        if (!entry.resolved) continue;
        let url;
        try { url = new URL(entry.resolved); } catch { continue; }
        if (forReplit) {
            if (url.hostname !== "registry.npmjs.org") continue;
            entry.resolved = `http://package-firewall.replit.internal/npm${url.pathname}`;
            changed++;
            continue;
        }
        if (url.hostname !== "package-firewall.replit.internal") continue;
        if (!url.pathname.startsWith("/npm/")) throw new Error("Unexpected proxy tarball path");
        url.protocol = "https:";
        url.hostname = "registry.npmjs.org";
        url.port = "";
        url.pathname = url.pathname.slice(4);
        entry.resolved = url.href;
        changed++;
    }
    return changed;
}

if (require.main === module) {
    const file = path.resolve(__dirname, "../package-lock.json");
    const lock = JSON.parse(fs.readFileSync(file, "utf8"));
    const forReplit = process.argv.includes("--replit");
    const changed = makePortable(lock, forReplit);
    fs.writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
    console.log(`Lockfile: normalized ${changed} URLs for ${forReplit ? "Replit's package firewall" : "portable deployment"}; versions and integrity hashes retained.`);
}

module.exports = { makePortable };
