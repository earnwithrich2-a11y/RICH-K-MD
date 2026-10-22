const { gmd } = require("../RICHK-MD-core/gmdCmds");
const { maintenance } = require("../RICHK-MD-core/connection/maintenance");

for (const pattern of ["restart", "update"]) {
    gmd({
        pattern,
        ...(pattern === "update" ? { aliases: ["updatenow", "updt", "sync"] } : {}),
        category: "owner",
        maintenance: true,
        description: pattern === "restart" ? "Restart safely without clearing the login." :
            "Fast-forward from origin/main and restart without clearing the login.",
        filename: __filename,
    }, async (_from, socket, context) => maintenance.run(pattern, socket, context));
}
