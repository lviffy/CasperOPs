const MIN_UPLOAD_SIZE_BYTES = 127;
const DEFAULT_PREPARE_BUFFER_BYTES = 4096;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const RAW_PRIVATE_KEY_REGEX = /^[a-fA-F0-9]{64}$/;

let synapseSdkModulesPromise = null;
const archiveQueueByWallet = new Map();

function getFilecoinProvider() {
  return 'synapse';
}

function queueArchiveByWallet(walletPrivateKey, task) {
  const queueKey = walletPrivateKey.toLowerCase();
  const previousTask = archiveQueueByWallet.get(queueKey) || Promise.resolve();

  const currentTask = previousTask
    .catch(() => {})
    .then(task);

  const cleanupTask = currentTask.finally(() => {
    if (archiveQueueByWallet.get(queueKey) === cleanupTask) {
      archiveQueueByWallet.delete(queueKey);
    }
  });

  archiveQueueByWallet.set(queueKey, cleanupTask);
  return currentTask;
}

function normalizePrivateKey(privateKey) {
  const trimmed = String(privateKey || '').trim();
  if (!trimmed) {
    return '';
  }

  if (PRIVATE_KEY_REGEX.test(trimmed)) {
    return trimmed;
  }

  if (RAW_PRIVATE_KEY_REGEX.test(trimmed)) {
    return `0x${trimmed}`;
  }

  return trimmed;
}

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveWalletPrivateKey(overridePrivateKey = null) {
  if (typeof overridePrivateKey === 'string' && overridePrivateKey.trim()) {
    return normalizePrivateKey(overridePrivateKey);
  }

  return normalizePrivateKey(process.env.FILECOIN_WALLET_PRIVATE_KEY || '');
}

function isValidPrivateKey(privateKey) {
  return PRIVATE_KEY_REGEX.test(privateKey || '');
}

function isFilecoinStorageConfigured(options = {}) {
  return isValidPrivateKey(resolveWalletPrivateKey(options.privateKey || null));
}

function getPrepareBufferBytes() {
  const value = parseInt(process.env.FILECOIN_PREPARE_BUFFER_BYTES || `${DEFAULT_PREPARE_BUFFER_BYTES}`, 10);
  if (Number.isNaN(value) || value < 0) {
    return DEFAULT_PREPARE_BUFFER_BYTES;
  }

  return value;
}

function isInsufficientLockupFundsError(errorMessage) {
  return /InsufficientLockupFunds/i.test(String(errorMessage || ''));
}

function enrichLockupError(errorMessage) {
  const text = String(errorMessage || '');
  const match = text.match(/InsufficientLockupFunds\([^)]*\)\s*\(\s*(0x[a-fA-F0-9]{40})\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!match) {
    return text;
  }

  const minimumRequired = BigInt(match[2]);
  const available = BigInt(match[3]);
  const shortfall = minimumRequired > available ? minimumRequired - available : 0n;
  return `${text}\n\nLockup shortfall (wei): ${shortfall.toString()}`;
}

function buildPieceUri(pieceCid) {
  return pieceCid ? `filecoin://piece/${pieceCid}` : null;
}

function parsePieceCidFromUri(uri) {
  const value = String(uri || '').trim();
  if (!value) {
    return null;
  }

  const pieceUriPrefix = 'filecoin://piece/';
  if (value.toLowerCase().startsWith(pieceUriPrefix)) {
    return value.slice(pieceUriPrefix.length).trim() || null;
  }

  return null;
}

function normalizePieceCid(pieceCidValue) {
  if (!pieceCidValue) {
    return null;
  }

  if (typeof pieceCidValue === 'string') {
    const trimmed = pieceCidValue.trim();
    if (!trimmed || trimmed === '[object Object]') {
      return null;
    }

    // Some rows persisted a JSON-shaped CID string like {"/":"bafy..."}.
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const { parsed } = safeParseJson(trimmed);
      const normalizedFromJson = normalizePieceCid(parsed);
      if (normalizedFromJson) {
        return normalizedFromJson;
      }

      const slashMatch = trimmed.match(/["']\/["']\s*:\s*["']([^"']+)["']/);
      if (slashMatch?.[1]) {
        return slashMatch[1].trim();
      }

      return null;
    }

    return trimmed;
  }

  if (typeof pieceCidValue === 'object') {
    const slashPathCid = pieceCidValue['/'];
    if (typeof slashPathCid === 'string' && slashPathCid.trim()) {
      return slashPathCid.trim();
    }

    if (typeof pieceCidValue.toString === 'function') {
      const asString = pieceCidValue.toString();
      if (typeof asString === 'string' && asString.trim() && asString !== '[object Object]') {
        return asString.trim();
      }
    }
  }

  return null;
}

function ensureMinimumUploadSize(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('Expected Uint8Array payload');
  }

  if (bytes.byteLength >= MIN_UPLOAD_SIZE_BYTES) {
    return bytes;
  }

  const padded = new Uint8Array(MIN_UPLOAD_SIZE_BYTES);
  padded.set(bytes);
  return padded;
}

function encodePayload(payload, options = {}) {
  const body = {
    schemaVersion: '1.0',
    payload,
    metadata: options.metadata || {},
    name: options.name || `blockops-${Date.now()}`,
    namespace: options.namespace || 'blockops-agent-audit',
    timestamp: new Date().toISOString()
  };

  const serialized = JSON.stringify(body);
  const bytes = new TextEncoder().encode(serialized);
  return ensureMinimumUploadSize(bytes);
}

function decodeArchivedBytes(bytes) {
  const text = new TextDecoder().decode(bytes || new Uint8Array());
  // Stored payloads are padded to meet minimum upload size, trim trailing NUL bytes.
  return text.replace(/\u0000+$/g, '').trim();
}

function safeParseJson(text) {
  try {
    return {
      parsed: JSON.parse(text),
      error: null
    };
  } catch (error) {
    return {
      parsed: null,
      error: error?.message || String(error)
    };
  }
}

async function getSynapseClient() {
  if (!synapseSdkModulesPromise) {
    synapseSdkModulesPromise = Promise.all([
      import('@filoz/synapse-sdk'),
      import('@filoz/synapse-core/chains'),
      import('viem/accounts')
    ]);
  }

  return synapseSdkModulesPromise;
}

async function createSynapseClient(privateKey) {
  const [{ Synapse }, { calibration }, { privateKeyToAccount }] = await getSynapseClient();

  return Synapse.create({
    account: privateKeyToAccount(privateKey),
    source: String(process.env.SYNAPSE_SOURCE || 'blockops-agent-audit'),
    chain: calibration,
    withCDN: parseBooleanEnv(process.env.SYNAPSE_WITH_CDN, false)
  });
}

async function archiveJsonToFilecoin(payload, options = {}) {
  const walletPrivateKey = resolveWalletPrivateKey(options.privateKey || null);

  if (!isValidPrivateKey(walletPrivateKey)) {
    return {
      status: 'not_configured',
      provider: 'synapse',
      error: 'Filecoin signer key missing. Set FILECOIN_WALLET_PRIVATE_KEY or pass options.privateKey'
    };
  }

  return queueArchiveByWallet(walletPrivateKey, async () => {
    try {
      const synapse = await createSynapseClient(walletPrivateKey);
      const uploadBytes = encodePayload(payload, options);
      const prepareBufferBytes = getPrepareBufferBytes();
      const basePrepareDataSize = BigInt(uploadBytes.byteLength + prepareBufferBytes);
      const prepareTxHashes = [];

      const preparation = await synapse.storage.prepare({
        dataSize: basePrepareDataSize
      });

      let prepareTxHash = null;
      if (preparation?.transaction) {
        const txResult = await preparation.transaction.execute();
        prepareTxHash = txResult?.hash || null;
        if (prepareTxHash) {
          prepareTxHashes.push(prepareTxHash);
        }
      }

      let uploadResult;
      try {
        uploadResult = await synapse.storage.upload(uploadBytes);
      } catch (uploadError) {
        const uploadErrorMessage = uploadError?.message || String(uploadError);

        // Some uploads fail by a tiny lockup margin. Retry once with an additional prepare buffer.
        if (!isInsufficientLockupFundsError(uploadErrorMessage)) {
          throw uploadError;
        }

        const retryPreparation = await synapse.storage.prepare({
          dataSize: basePrepareDataSize + BigInt(prepareBufferBytes)
        });

        if (retryPreparation?.transaction) {
          const retryTx = await retryPreparation.transaction.execute();
          const retryHash = retryTx?.hash || null;
          if (retryHash) {
            prepareTxHash = retryHash;
            prepareTxHashes.push(retryHash);
          }
        }

        uploadResult = await synapse.storage.upload(uploadBytes);
      }

      const pieceCid = normalizePieceCid(uploadResult?.pieceCid || null);

      if (!pieceCid) {
        return {
          status: 'failed',
          provider: 'synapse',
          error: 'Synapse upload did not return pieceCid'
        };
      }

      return {
        status: 'stored',
        provider: 'synapse',
        pieceCid,
        // Keep cid alias for backward compatibility with current audit writer.
        cid: pieceCid,
        uri: buildPieceUri(pieceCid),
        prepareTxHash,
        prepareTxHashes,
        complete: Boolean(uploadResult?.complete),
        copiesStored: Array.isArray(uploadResult?.copies) ? uploadResult.copies.length : 0,
        failedAttempts: Array.isArray(uploadResult?.failedAttempts) ? uploadResult.failedAttempts.length : 0,
        size: uploadResult?.size || uploadBytes.byteLength
      };
    } catch (error) {
      const errorMessage = error?.message || String(error);
      return {
        status: 'failed',
        provider: 'synapse',
        error: enrichLockupError(errorMessage)
      };
    }
  });
}

async function retrieveJsonFromFilecoin(options = {}) {
  const requestedPieceCid = normalizePieceCid(options.pieceCid) || parsePieceCidFromUri(options.uri);

  if (!requestedPieceCid) {
    return {
      status: 'failed',
      provider: 'synapse',
      error: 'Missing pieceCid for retrieval'
    };
  }

  const walletPrivateKey = resolveWalletPrivateKey(options.privateKey || null);
  if (!isValidPrivateKey(walletPrivateKey)) {
    return {
      status: 'not_configured',
      provider: 'synapse',
      pieceCid: requestedPieceCid,
      error: 'Filecoin signer key missing. Set FILECOIN_WALLET_PRIVATE_KEY or pass options.privateKey'
    };
  }

  try {
    const synapse = await createSynapseClient(walletPrivateKey);
    const data = await synapse.storage.download({
      pieceCid: requestedPieceCid,
      withCDN: parseBooleanEnv(process.env.SYNAPSE_WITH_CDN, false)
    });

    const text = decodeArchivedBytes(data);
    const { parsed, error: parseError } = safeParseJson(text);

    return {
      status: 'stored',
      provider: 'synapse',
      pieceCid: requestedPieceCid,
      uri: buildPieceUri(requestedPieceCid),
      contentType: parsed ? 'json' : 'text',
      parsed,
      payload: parsed && typeof parsed === 'object' && parsed !== null && Object.prototype.hasOwnProperty.call(parsed, 'payload')
        ? parsed.payload
        : parsed,
      metadata: parsed && typeof parsed === 'object' && parsed !== null && Object.prototype.hasOwnProperty.call(parsed, 'metadata')
        ? parsed.metadata
        : null,
      rawText: text,
      parseError
    };
  } catch (error) {
    return {
      status: 'failed',
      provider: 'synapse',
      pieceCid: requestedPieceCid,
      error: error?.message || String(error)
    };
  }
}

module.exports = {
  archiveJsonToFilecoin,
  buildPieceUri,
  getFilecoinProvider,
  isFilecoinStorageConfigured,
  parsePieceCidFromUri,
  retrieveJsonFromFilecoin
};
