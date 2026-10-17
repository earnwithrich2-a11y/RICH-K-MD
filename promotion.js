const { gmd } = require("../RICHK-MD-core/gmdCmds");

const promotions = [
    {
        pattern: "boost", aliases: ["services"],
        description: "Social boosting services and website",
        text: "*RICH-K-MD • Social Services*\n\n" +
            "• TikTok services\n• Instagram services\n• WhatsApp channel member services\n" +
            "• YouTube services\n• Telegram services\n\n" +
            "Browse current packages, prices and availability:\nhttps://boosting.richkaurex.site\n\n" +
            "Use services in line with each platform's rules. Never share your password or verification codes.",
    },
    {
        pattern: "sms", aliases: ["otp"],
        description: "Virtual verification number guidance",
        text: "*RICH-K-MD • Virtual Numbers*\n\n" +
            "Visit https://boosting.richkaurex.site/sms\n\n" +
            "1. Check the available countries, including Ghana, Nigeria and the US.\n" +
            "2. Select your country and service, and review the price and terms.\n" +
            "3. Fund your account, purchase an available number, and follow the site's SMS instructions.\n\n" +
            "WhatsApp, Telegram, PayPal and other services may reject virtual numbers. " +
            "Availability and acceptance are not guaranteed. Use only for accounts you own and where permitted; " +
            "never use temporary numbers for important financial accounts or to bypass verification rules.",
    },
    {
        pattern: "deposit", aliases: ["balance"],
        description: "How to fund your services account",
        text: "*RICH-K-MD • Funding & Balance*\n\n" +
            "Sign in at https://boosting.richkaurex.site and open your wallet, balance or deposit page.\n\n" +
            "Choose a supported method shown at checkout:\n" +
            "• Mobile Money: MTN, Telecel or AirtelTigo (if available)\n• Card (if available)\n\n" +
            "Enter the amount, review any fees, and complete the payment using the site's official instructions. " +
            "Check your account balance afterward and keep your payment reference if support is needed.\n\n" +
            "This command gives instructions only; it does not access your balance or take payments. " +
            "Never send your MoMo PIN, card details or OTP to the bot.",
    },
];

for (const { text, ...metadata } of promotions) {
    gmd({ ...metadata, category: "general" }, async (from, socket) => {
        await socket.sendMessage(from, { text });
    });
}
