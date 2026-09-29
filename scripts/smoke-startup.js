const { spawn } = require("child_process");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const child = spawn(process.execPath, ["index.js"], {
    cwd: projectRoot,
    env: {
        ...process.env,
        BOT_SMOKE_TEST: "1",
        PORT: "5127",
    },
    stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let finished = false;
let verifying = false;

function stopChild() {
    if (!child.killed) child.kill("SIGTERM");
}

function fail(message) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    stopChild();
    console.error(message);
    if (output.trim()) console.error(output.trim());
    process.exitCode = 1;
}

async function verifyHealth(port) {
    if (verifying || finished) return;
    verifying = true;
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        const body = await response.json();
        if (!response.ok || body.status !== "alive" || typeof body.uptime !== "number") {
            throw new Error(`Unexpected response: ${response.status} ${JSON.stringify(body)}`);
        }

        finished = true;
        clearTimeout(timeout);
        stopChild();
        console.log("Startup validation passed: runtime modules loaded and /health responded");
    } catch (error) {
        fail(`Startup validation failed: ${error.message}`);
    }
}

function capture(chunk) {
    const text = chunk.toString();
    output += text;
    const match = output.match(/Server Running on Port: (\d+)/);
    if (match) verifyHealth(match[1]);
}

child.stdout.on("data", capture);
child.stderr.on("data", capture);
child.on("error", (error) => fail(`Could not start bot: ${error.message}`));
child.on("exit", (code, signal) => {
    if (!finished) fail(`Bot exited before health verification (code ${code}, signal ${signal})`);
});

const timeout = setTimeout(() => {
    fail("Startup validation timed out waiting for /health");
}, 15000);