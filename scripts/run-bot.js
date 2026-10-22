const { spawn } = require("child_process");
const path = require("path");

function restartDelay(attempt) {
    return Math.min(60000, 1000 * 2 ** Math.min(attempt, 6));
}
function supervise({
    spawnChild = () => spawn(process.execPath, ["index.js"], {
        cwd: path.resolve(__dirname, ".."), stdio: "inherit", env: process.env,
    }),
    schedule = setTimeout,
    exit = code => process.exit(code),
} = {}) {
    let child;
    let timer;
    let stopping = false;
    let attempts = 0;
    function start() {
        if (stopping) return;
        const started = Date.now();
        child = spawnChild();
        child.once("error", () => console.error("[Supervisor] Bot process could not start."));
        child.once("exit", (code) => {
            if (stopping) return exit(0);
            if (code === 0) {
                attempts = 0;
                console.info("[Supervisor] Bot requested a clean restart.");
                timer = schedule(start, 1000);
                return;
            }
            if (Date.now() - started > 60000) attempts = 0;
            const delay = restartDelay(attempts++);
            console.error(`[Supervisor] Bot exited unexpectedly; restarting in ${delay}ms.`);
            timer = schedule(start, delay);
        });
    }
    function stop(signal = "SIGTERM") {
        if (stopping) return;
        stopping = true;
        clearTimeout(timer);
        if (child && child.exitCode == null) {
            child.kill(signal);
            const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
            deadline.unref?.();
        } else exit(0);
    }
    start();
    return { stop };
}
if (require.main === module) {
    const runner = supervise();
    process.once("SIGTERM", () => runner.stop());
    process.once("SIGINT", () => runner.stop("SIGINT"));
}
module.exports = { supervise, restartDelay };
