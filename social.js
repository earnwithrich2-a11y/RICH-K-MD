const { gmd } = require("../RICHK-MD-core/gmdCmds");
const { sweetMessages, createMessagePicker } = require("../RICHK-MD-core/sweetMessages");

const socialReplies = [
  {
    pattern: "love",
    react: "❤️",
    description: "Send a different sweet love message",
  },
  {
    pattern: "goodnight",
    react: "🌙",
    description: "Send a different sweet good night message",
  },
  {
    pattern: "goodmorning",
    react: "🌅",
    description: "Send a different sweet good morning message",
  },
];

for (const { pattern, react, description } of socialReplies) {
  const pickMessage = createMessagePicker(sweetMessages[pattern]);
  gmd(
    {
      pattern,
      react,
      category: "general",
      description,
    },
    async (from, Gifted) => {
      await Gifted.sendMessage(from, { text: pickMessage() });
    },
  );
}

module.exports = {};