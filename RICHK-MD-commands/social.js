const { gmd } = require("../RICHK-MD-core/gmdCmds");

const socialReplies = [
  {
    pattern: "love",
    react: "❤️",
    description: "Send a short love message",
    text: "❤️ Sending love and good vibes your way!",
  },
  {
    pattern: "goodnight",
    react: "🌙",
    description: "Send a good night greeting",
    text: "🌙 Good night! Rest well and wake up refreshed.",
  },
  {
    pattern: "goodmorning",
    react: "🌅",
    description: "Send a good morning greeting",
    text: "🌅 Good morning! Wishing you a bright, happy day!",
  },
];

for (const { pattern, react, description, text } of socialReplies) {
  gmd(
    {
      pattern,
      react,
      category: "general",
      description,
    },
    async (from, Gifted) => {
      await Gifted.sendMessage(from, { text });
    },
  );
}

module.exports = {};