const { DATABASE } = require('./database');
const { DataTypes } = require('sequelize');

const SudoDB = DATABASE.define('SudoUser', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
}, {
    tableName: 'sudo_users',
    timestamps: true,
});

let initialization;
function initializeSudoDB() {
    if (!initialization) initialization = SudoDB.sync().catch(error => {
        initialization = null;
        throw error;
    });
    return initialization;
}

let _sudoCache = null;

async function getSudoNumbers() {
    await initializeSudoDB();
    if (_sudoCache) return _sudoCache;
    const records = await SudoDB.findAll();
    _sudoCache = records.map(record => record.number);
    return _sudoCache;
}

function getCachedSudoNumbers() {
    return [...(_sudoCache || [])];
}

async function setSudo(number) {
    await initializeSudoDB();
    try {
        const [record, created] = await SudoDB.findOrCreate({
            where: { number: number },
            defaults: { number: number },
        });
        if (_sudoCache) _sudoCache = [...new Set([..._sudoCache, number])];
        else await getSudoNumbers();
        return created;
    } catch (error) {
        console.error('[SUDO][SET_ERROR]:', error);
        return false;
    }
}

async function delSudo(number) {
    await initializeSudoDB();
    try {
        const deleted = await SudoDB.destroy({
            where: { number: number },
        });
        if (_sudoCache) _sudoCache = _sudoCache.filter(value => value !== number);
        return deleted > 0;
    } catch (error) {
        console.error('[SUDO][DEL_ERROR]:', error);
        return false;
    }
}

async function clearAllSudo() {
    await initializeSudoDB();
    try {
        const deleted = await SudoDB.destroy({ where: {} });
        _sudoCache = [];
        return deleted;
    } catch (error) {
        console.error('[SUDO][CLEAR_ALL_ERROR]:', error);
        return 0;
    }
}

const { isConnectedOwner, normalizeIdentity } = require("../connection/ownerIdentity");

async function isSuperUser(jid, Gifted) {
    const sender = normalizeIdentity(jid);
    if (!sender) return false;
    if (isConnectedOwner(Gifted, jid)) return true;
    const sudoNumbers = await getSudoNumbers();
    return sudoNumbers.some(value => normalizeIdentity(value.includes("@") ? value : `${value}@s.whatsapp.net`) === sender);
}

module.exports = {
    SudoDB,
    getSudoNumbers,
    getCachedSudoNumbers,
    setSudo,
    delSudo,
    clearAllSudo,
    isSuperUser,
};
