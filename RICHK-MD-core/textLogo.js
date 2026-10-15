const sharp = require("sharp");

const MAX_LOGO_TEXT = 80;
const escapeXml = text => text.replace(/[<>&"']/g, char => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
}[char]));

function normalizeLogoText(input) {
    const text = String(input || "").normalize("NFC")
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
        .replace(/\s+/g, " ").trim();
    if (!text) throw new Error("Please provide text for the logo.");
    if (Array.from(text).length > MAX_LOGO_TEXT) {
        throw new Error(`Please use ${MAX_LOGO_TEXT} characters or fewer for the logo.`);
    }
    return text;
}

function wrapText(text) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
        if (line && Array.from(`${line} ${word}`).length <= 24) {
            line += ` ${word}`;
            continue;
        }
        if (line) { lines.push(line); line = ""; }
        const characters = Array.from(word);
        while (characters.length > 24) lines.push(characters.splice(0, 24).join(""));
        line = characters.join("");
    }
    if (line) lines.push(line);
    return lines;
}

async function generateTextLogo(input) {
    const text = normalizeLogoText(input);
    const words = text.split(" ");
    const initials = words.length > 1
        ? [Array.from(words[0])[0], Array.from(words[1])[0]].join("")
        : Array.from(text).slice(0, 2).join("");
    const lines = wrapText(text);
    const labels = lines.map((line, index) =>
        `<text x="512" y="${lines.length === 1 ? 744 : 690 + index * 52}" font-size="40" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" fill="url(#gold)">${escapeXml(line)}</text>`,
    ).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="gold" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stop-color="#a46b14"/><stop offset=".3" stop-color="#ffe9a0"/>
          <stop offset=".52" stop-color="#d9a537"/><stop offset=".75" stop-color="#fff0b5"/>
          <stop offset="1" stop-color="#aa711d"/>
        </linearGradient>
        <radialGradient id="background"><stop stop-color="#242017"/><stop offset="1" stop-color="#080808"/></radialGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#background)"/>
      <circle cx="512" cy="512" r="468" fill="none" stroke="url(#gold)" stroke-width="9"/>
      <circle cx="512" cy="512" r="451" fill="none" stroke="#8e692a" stroke-width="1"/>
      <circle cx="512" cy="398" r="217" fill="none" stroke="url(#gold)" stroke-width="5"/>
      <circle cx="512" cy="398" r="201" fill="none" stroke="#8e692a" stroke-width="1"/>
      <text x="512" y="458" font-family="DejaVu Serif, serif" font-size="170" font-weight="bold" text-anchor="middle" fill="url(#gold)">${escapeXml(initials.toUpperCase())}</text>
      <path d="M380 632H644" stroke="url(#gold)" stroke-width="3"/>
      ${labels}
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { generateTextLogo, normalizeLogoText, MAX_LOGO_TEXT };
