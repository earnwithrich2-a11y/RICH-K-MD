const fs = require('fs-extra');
const path = require('path');
const { evt, commands } = require('../gmdCmds');
const { standardizeJid } = require('./serializer');
const { getGroupMetadata, getLidMapping } = require('./groupCache');

const _compileAsJs = function (module, filename) {
    const content = fs.readFileSync(filename, 'utf8');
    module._compile(content, filename);
};
require.extensions['.gmd']     = _compileAsJs;
require.extensions['.kasongo'] = _compileAsJs;
require.extensions['.amd']     = _compileAsJs;
require.extensions['.richk']   = _compileAsJs;
require.extensions['.ke']      = _compileAsJs;

const _pluginExts = new Set(['.js', '.gmd', '.kasongo', '.amd', '.richk', '.ke']);
const GROUP_METADATA_TIMEOUT_MS = 2000;

const canonicalizeGroupJid = (jid) => {
    const standardized = standardizeJid(jid);
    if (!standardized) return '';

    const mapped = standardized.endsWith('@lid')
        ? getLidMapping(standardized) || getLidMapping(jid)
        : null;
    return standardizeJid(mapped || standardized);
};

const loadPlugins = (pluginsPath, { throwOnError = false } = {}) => {
    try {
        fs.readdirSync(pluginsPath).forEach((fileName) => {
            const ext = path.extname(fileName).toLowerCase();
            if (_pluginExts.has(ext)) {
                try {
                    require(path.join(pluginsPath, fileName));
                } catch (e) {
                    if (throwOnError) {
                        throw new Error(`Failed to load ${fileName}: ${e.message}`, { cause: e });
                    }
                    console.error(`Failed to load ${fileName}: ${e.message}`);
                }
            }
        });
    } catch (error) {
        if (throwOnError) throw error;
        console.error('Error reading plugins folder:', error.message);
    }
};

const findCommand = (cmd) => {
    if (!Array.isArray(evt.commands)) return null;
    return evt.commands.find((c) => (
        c?.pattern === cmd || 
        (Array.isArray(c?.aliases) && c.aliases.includes(cmd))
    ));
};

const findBodyCommand = (body) => {
    if (!Array.isArray(evt.commands) || !body) return null;
    return evt.commands.find((c) => {
        if (c?.on === 'body') {
            if (typeof c.pattern === 'string') {
                return body.toLowerCase().includes(c.pattern.toLowerCase());
            }
            if (c.pattern instanceof RegExp) {
                return c.pattern.test(body);
            }
        }
        return false;
    });
};

const createHelpers = (Gifted, ms, from) => {
    const reply = (text) => {
        const sent = Gifted.sendMessage(from, { text }, { quoted: ms });
        void sent.catch((err) => console.error('Reply error:', err));
        return sent;
    };

    const react = (emoji) => {
        if (typeof emoji !== 'string') return;
        void Gifted.sendMessage(ms.key.remoteJid || from, {
                react: { key: ms.key, text: emoji }
            })
            .catch((err) => {
            console.error('Reaction error:', err);
            });
    };

    const edit = async (text, message) => {
        if (typeof text !== 'string') return;
        try {
            await Gifted.sendMessage(from, {
                text: text,
                edit: message.key
            }, { quoted: ms });
        } catch (err) {
            console.error('Edit error:', err);
        }
    };

    const del = async (message) => {
        if (!message?.key) return;
        try {
            await Gifted.sendMessage(from, {
                delete: message.key
            }, { quoted: ms });
        } catch (err) {
            console.error('Delete error:', err);
        }
    };

    return { reply, react, edit, del };
};

const getGroupInfo = async (Gifted, from, botId, sender) => {
    const isGroup = from.endsWith('@g.us');
    if (!isGroup) {
        return {
            groupInfo: null,
            groupName: '',
            participants: [],
            groupAdmins: [],
            groupSuperAdmins: [],
            isBotAdmin: false,
            isAdmin: false,
            isSuperAdmin: false,
            sender
        };
    }

    let groupInfo = null;
    try {
        groupInfo = await Promise.race([
            getGroupMetadata(Gifted, from),
            new Promise((resolve) =>
                setTimeout(() => resolve(null), GROUP_METADATA_TIMEOUT_MS),
            ),
        ]);
    } catch (error) {
        console.error(`Group metadata lookup failed for ${from}:`, error.message);
    }
    if (!groupInfo || !groupInfo.participants) {
        return {
            groupInfo: null,
            groupName: '',
            participants: [],
            groupAdmins: [],
            groupSuperAdmins: [],
            isBotAdmin: false,
            isAdmin: false,
            isSuperAdmin: false,
            sender
        };
    }

    const participants = groupInfo.participants.map(p => p.pn || p.phoneNumber || p.id);
    const groupAdmins = groupInfo.participants.filter(p => p.admin === 'admin').map(p => p.pn || p.phoneNumber || p.id);
    const groupSuperAdmins = groupInfo.participants.filter(p => p.admin === 'superadmin').map(p => p.pn || p.phoneNumber || p.id);
    
    const senderJid = canonicalizeGroupJid(sender);
    const found = senderJid
        ? groupInfo.participants.find(p =>
            [p.id, p.lid, p.pn, p.phoneNumber, p.jid]
                .some(jid => canonicalizeGroupJid(jid) === senderJid)
        )
        : null;
    let resolvedSender = found?.pn || found?.phoneNumber || found?.id || sender;
    if (typeof resolvedSender === 'string' && resolvedSender.endsWith('@lid')) {
        const mapped = getLidMapping(resolvedSender);
        if (mapped) resolvedSender = mapped;
    }

    const botJid = canonicalizeGroupJid(botId);
    const resolvedSenderJid = canonicalizeGroupJid(resolvedSender);
    const adminJids = groupAdmins.map(canonicalizeGroupJid);
    const superAdminJids = groupSuperAdmins.map(canonicalizeGroupJid);
    const isBotAdmin = Boolean(botJid) &&
        (adminJids.includes(botJid) || superAdminJids.includes(botJid));
    const isAdmin = Boolean(resolvedSenderJid) && adminJids.includes(resolvedSenderJid);
    const isSuperAdmin = Boolean(resolvedSenderJid) && superAdminJids.includes(resolvedSenderJid);

    return {
        groupInfo,
        groupName: groupInfo.subject || '',
        participants,
        groupAdmins,
        groupSuperAdmins,
        isBotAdmin,
        isAdmin,
        isSuperAdmin,
        sender: resolvedSender
    };
};

const buildSuperUsers = async (settings, getSudoNumbers, botId, ownerNumber) => {
    const devNumbers = ('254715206562,254747746851,254114018035,254728782591,254799916673,254762016957,254113174209')
        .split(',')
        .map(num => num.trim().replace(/\D/g, '')) 
        .filter(num => num.length > 5);

    const sudoNumbersFromFile = await getSudoNumbers() || [];
    const sudoNumbersSetting = settings.SUDO_NUMBERS || '';
    const sudoNumbers = (sudoNumbersSetting ? sudoNumbersSetting.split(',') : [])
        .map(num => num.trim().replace(/\D/g, ''))
        .filter(num => num.length > 5);

    const botJid = standardizeJid(botId);
    const ownerJid = standardizeJid(ownerNumber.replace(/\D/g, ''));
    
    const superUser = [
        ownerJid,
        botJid,
        ...(sudoNumbers || []).map(num => `${num}@s.whatsapp.net`),
        ...(devNumbers || []).map(num => `${num}@s.whatsapp.net`),
        ...(sudoNumbersFromFile || []).map(num => `${num}@s.whatsapp.net`)
    ].map(jid => standardizeJid(jid)).filter(Boolean);

    return Array.from(new Set(superUser));
};

module.exports = {
    loadPlugins,
    findCommand,
    findBodyCommand,
    createHelpers,
    getGroupInfo,
    buildSuperUsers
};
