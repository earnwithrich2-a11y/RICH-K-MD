const { DATABASE } = require("./database");
const { DataTypes } = require("sequelize");
const path = require("path");
const config = require("../../config");

const packageJson = require("../../package.json");

const SettingsDB = DATABASE.define(
    "BotSettings",
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        key: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
        },
        value: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        tableName: "bot_settings",
        timestamps: true,
    },
);

const DEFAULT_SETTINGS = {
    PREFIX: ".",
    OWNER_NAME: "RICHK-MD",
    OWNER_NUMBER: "254747746851",
    BOT_NAME: "RICHK-MD",
    FOOTER: "Powered by RICHK-MD",
    CAPTION: "© 2026 RICHK-MD",
    BOT_PIC: "https://files.gifted.co.ke/image/u90mimage.jpg",
    VERSION: packageJson.version || "5.0.0",
    MODE: config.MODE || "public",
    BOT_PAUSED: "false",
    WARN_COUNT: "3",
    TIME_ZONE: config.TIME_ZONE || "Africa/Accra",
    DM_PRESENCE: "online",
    GC_PRESENCE: "online",
    CHATBOT: "false",
    CHATBOT_MODE: "inbox",
    STARTING_MESSAGE: "true",
    ANTIDELETE: "indm",
    ANTI_EDIT: "indm",
    ANTICALL: "false",
    ANTICALL_MSG: "*_📞 Auto Call Reject Mode Active. 📵 No Calls Allowed!_*",
    AUTO_LIKE_STATUS: config.AUTO_LIKE_STATUS || "true",
    AUTO_READ_STATUS: config.AUTO_READ_STATUS || "true",
    STATUS_LIKE_EMOJIS: "💛,❤️,💜,🤍,💙",
    AUTO_REPLY_STATUS: "false",
    STATUS_REPLY_TEXT: "*ʏᴏᴜʀ sᴛᴀᴛᴜs ᴠɪᴇᴡᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ ✅*",
    AUTO_REACT: "off",
    AUTO_REPLY: "false",
    AUTO_READ_MESSAGES: "off",
    AUTO_BIO: "false",
    AUTO_BLOCK: "",
    YT: "https://rivo-skills.everyshop.space",
    NEWSLETTER_JID: "120363426409647211@newsletter",
    GC_JID: "EyXMwZx0V556mTYY0eMQ5K",
    NEWSLETTER_URL: "https://whatsapp.com/channel/0029VbCpYtZLtOj5LDuj7Q1p",
    BOT_REPO: "",
    PACK_NAME: "RICHK-MD",
    PACK_AUTHOR: "RICHK-MD",
    SUDO_NUMBERS: "",
    PM_PERMIT: "false",
    ANTIVIEWONCE: "indm",
};

let initialized = false;
let allSettingsCache = null;
let allSettingsCacheExpiresAt = 0;
let allSettingsCacheRevision = 0;
let allSettingsReadInFlight = null;
const ALL_SETTINGS_CACHE_TTL_MS = 1000;

const GROUP_ONLY_SETTINGS = [
    "WELCOME_MESSAGE",
    "GOODBYE_MESSAGE",
    "GROUP_EVENTS",
    "ANTILINK",
];

async function initializeSettings() {
    if (initialized) return;

    await SettingsDB.sync();

    await SettingsDB.destroy({
        where: { key: GROUP_ONLY_SETTINGS },
    });

    const legacyBrandValues = {
        BOT_NAME: ["𝐀𝐓𝐀𝐒𝐒𝐀-𝐌𝐃", "ATASSA MD", "ATASSA-MD"],
        OWNER_NAME: ["𝐆𝐈𝐅𝐓𝐄𝐃 𝐓𝐄𝐂𝐇", "Gifted Tech", "GiftedTech"],
        FOOTER: ["ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɢɪғᴛᴇᴅ ᴛᴇᴄʜ"],
        CAPTION: ["©𝟐𝟎𝟐𝟓 𝐀𝐓𝐀𝐒𝐒𝐀-𝐌𝐃 𝐕𝟓"],
        BOT_REPO: ["mauricegift/atassa"],
        PACK_NAME: ["𝐀𝐓𝐀𝐒𝐒𝐀-𝐌𝐃", "ATASSA MD", "ATASSA-MD"],
        PACK_AUTHOR: ["𝐆𝐈𝐅𝐓𝐄𝐃 𝐓𝐄𝐂𝐇", "Gifted Tech", "GiftedTech"],
    };
    for (const [key, legacyValues] of Object.entries(legacyBrandValues)) {
        const record = await SettingsDB.findOne({ where: { key } });
        if (record && legacyValues.includes(record.value)) {
            record.value = DEFAULT_SETTINGS[key];
            await record.save();
        }
    }

    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
        await SettingsDB.findOrCreate({
            where: { key },
            defaults: { key, value: defaultValue },
        });
    }

    initialized = true;
    console.log("✅ Bot Settings Initialized");
}

async function getSetting(key) {
    if (!initialized) await initializeSettings();

    const record = await SettingsDB.findOne({ where: { key } });
    if (record) {
        return record.value;
    }

    return DEFAULT_SETTINGS[key] || null;
}

async function setSetting(key, value) {
    if (!initialized) await initializeSettings();

    const [record, created] = await SettingsDB.findOrCreate({
        where: { key },
        defaults: { key, value },
    });

    if (!created) {
        record.value = value;
        await record.save();
    }

    invalidateAllSettingsCache();
    return true;
}

function invalidateAllSettingsCache() {
    allSettingsCacheRevision += 1;
    allSettingsCache = null;
    allSettingsCacheExpiresAt = 0;
}

async function getAllSettings() {
    if (!initialized) await initializeSettings();

    if (allSettingsCache && Date.now() < allSettingsCacheExpiresAt) {
        return { ...allSettingsCache };
    }

    const revision = allSettingsCacheRevision;
    if (allSettingsReadInFlight?.revision === revision) {
        return { ...(await allSettingsReadInFlight.promise) };
    }

    const inFlight = {
        revision,
        promise: (async () => {
            const records = await SettingsDB.findAll();
            const settings = {};
            for (const record of records) {
                settings[record.key] = record.value;
            }

            // A write may have invalidated this read while the query was pending.
            if (allSettingsCacheRevision === revision) {
                allSettingsCache = settings;
                allSettingsCacheExpiresAt = Date.now() + ALL_SETTINGS_CACHE_TTL_MS;
            }
            return settings;
        })(),
    };
    allSettingsReadInFlight = inFlight;

    try {
        return { ...(await inFlight.promise) };
    } finally {
        if (allSettingsReadInFlight === inFlight) {
            allSettingsReadInFlight = null;
        }
    }
}

async function resetSetting(key) {
    if (!initialized) await initializeSettings();

    const defaultValue = DEFAULT_SETTINGS[key];
    if (defaultValue !== undefined) {
        await setSetting(key, defaultValue);
        return defaultValue;
    }
    return null;
}

async function resetAllSettings() {
    if (!initialized) await initializeSettings();

    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
        await setSetting(key, defaultValue);
    }
    return true;
}

module.exports = {
    SettingsDB,
    DEFAULT_SETTINGS,
    initializeSettings,
    getSetting,
    setSetting,
    getAllSettings,
    resetSetting,
    resetAllSettings,
};
