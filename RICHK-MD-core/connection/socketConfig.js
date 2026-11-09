const NodeCache = require('node-cache');
const { makeCacheableSignalKeyStore, Browsers } = require('gifted-baileys');
const { findMessageForRetryWithWait } = require('./messageRetry');
const { cachedGroupMetadata } = require('./groupCache');
const { createTransportLogger } = require('./transportLogger');
const { makeAtomicSignalRepository } = require('./atomicSignalRepository');

const _userDevicesCache = new NodeCache({ stdTTL: 1800, useClones: false });

const createSocketConfig = (version, state, logger, store) => {
    return {
        version,
        logger: createTransportLogger(),
        browser: Browsers.macOS('Desktop'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        makeSignalRepository: makeAtomicSignalRepository,
        atomicSignalOperations: true,
        prioritizeLiveMessages: true,
        transactionOpts: { maxCommitRetries: 3, delayBetweenTriesMs: 10 },
        cachedGroupMetadata,
        userDevicesCache: _userDevicesCache,
        connectTimeoutMs: 15000,
        defaultQueryTimeoutMs: 20000,
        keepAliveIntervalMs: 20000,
        fireInitQueries: true,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        bufferLiveMessages: false,
        shouldSyncHistoryMessage: () => false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        generateHighQualityLinkPreview: false,
        getMessage: async key => {
            try {
                return (await findMessageForRetryWithWait(store, key,
                    [state.creds.me?.id, state.creds.me?.lid])).message;
            } catch {
                console.warn("[WhatsApp] Resend lookup unavailable; saved messages retained.");
                return undefined;
            }
        },
        emitOwnEvents: true,
        patchMessageBeforeSending: (message, jids) => {
            const requiresPatch = !!(
                message.buttonsMessage ||
                message.templateMessage ||
                message.listMessage
            );
            if (requiresPatch) {
                message = {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: {
                                deviceListMetadataVersion: 2,
                                deviceListMetadata: {},
                            },
                            ...message,
                        },
                    },
                };
            }
            // Upstream owns recipient fan-out and device-sent copies. Its
            // per-recipient format differs from the retired fork's flat form.
            return message;
        }
    };
};

module.exports = { createSocketConfig };
