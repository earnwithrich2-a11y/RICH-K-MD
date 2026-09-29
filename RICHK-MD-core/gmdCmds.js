let commands = [];
const tabCmds = [];

const evt = {
    events: {},
    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    },
    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach((callback) => callback(data));
        }
    },
};

function gmd(obj, functions) {
    if (!obj || typeof obj !== "object") {
        throw new TypeError("Command metadata must be an object");
    }
    if (!obj.pattern || typeof obj.pattern !== "string") {
        throw new TypeError("Command pattern must be a non-empty string");
    }
    if (typeof functions !== "function") {
        throw new TypeError(`Command handler for ${obj.pattern} must be a function`);
    }

    let infoComs = obj;
    if (!obj.category) infoComs.category = "general"; 
    if (!obj.react) infoComs.react = "🚀";
    if (!obj.dontAddCommandList) infoComs.dontAddCommandList = false; 
    infoComs.function = functions;
    
    const stack = new Error().stack;
    const callerLine = stack?.split('\n')[2] || "";
    const fileMatch =
        callerLine.match(/\((.*):\d+:\d+\)/) ||
        callerLine.match(/at (.*):\d+:\d+/);
    infoComs.filename = fileMatch?.[1] || obj.filename || "unknown";
    
    commands.push(infoComs);
    return infoComs;
}

module.exports = { gmd, commands, evt };

evt.commands = commands;  // this was hell and it took me 3 hours to fix since bot wasn't responding to commands after i had changed more bot structure logic
