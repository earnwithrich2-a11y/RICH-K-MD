const os = require("node:os");
const { performance } = require("node:perf_hooks");

function performancePanel(startedAt = performance.now(), system = {}) {
    const now = system.now ?? performance.now();
    const latency = Math.max(0, now - startedAt);
    const uptime = Math.floor(system.uptime ?? process.uptime());
    const total = system.totalMemory ?? os.totalmem();
    const free = system.freeMemory ?? os.freemem();
    const mb = bytes => (bytes / 1024 / 1024).toFixed(1);
    return [
        "╭─ ⚡ RICH-K-MD • LIVE STATUS",
        "╰─────────────────",
        "",
        `⚡ Response Speed: ${latency.toFixed(2)} ms / ${(latency / 1000).toFixed(3)} s (dispatch)`,
        `⏱️ Bot Uptime: ${Math.floor(uptime / 86400)}d ${Math.floor(uptime % 86400 / 3600)}h ${Math.floor(uptime % 3600 / 60)}m`,
        `📊 Server RAM Usage: ${mb(Math.max(0, total - free))} MB / ${mb(total)} MB`,
        `📦 Bot Process RAM: ${mb(system.rss ?? process.memoryUsage().rss)} MB`,
        "👑 Bot Name: RICH-K-MD",
        "",
        "─ RICH-K-MD",
    ].join("\n");
}

module.exports = { performancePanel };
