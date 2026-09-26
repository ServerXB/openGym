import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SYNC_PROTOCOL = 1;
export const STATE_ENVELOPE_FORMAT = 'opengym-sync-state';
const DEFAULT_MAX_RECEIPTS = 128;

export class StateStoreError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = 'StateStoreError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function payloadHash(baseRevision, state) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(stableValue({ baseRevision, state })))
    .digest('base64url');
}

function cleanIdentifier(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StateStoreError(400, 'invalid_request', `${field} required`);
  }
  const result = value.trim();
  if (result.length > 128) {
    throw new StateStoreError(400, 'invalid_request', `${field} too long`);
  }
  return result;
}

export function canonicalServerState(input) {
  if (!isObject(input)) throw new StateStoreError(400, 'invalid_request', 'state required');
  // Requests are JSON, nevertheless clone here so callers never observe server-side cleanup.
  const state = JSON.parse(JSON.stringify(input));
  delete state.active; // An in-progress workout is deliberately device-local.
  delete state._ts;    // Sync metadata is represented by the envelope revision/timestamp.
  delete state._sync;
  delete state.__sync;
  delete state.sync;
  delete state.syncMeta;
  delete state.syncMetadata;
  for (const key of Object.keys(state)) {
    if (key.startsWith('__sync')) delete state[key];
  }
  return state;
}

function emptyRecord() {
  return { state: null, revision: 0, updatedAt: null, receipts: [], legacy: false };
}

export function decodeStoredState(value) {
  if (!isObject(value)) throw new Error('invalid state file');
  if (value.format !== STATE_ENVELOPE_FORMAT) {
    return { state: value, revision: 0, updatedAt: value._ts || null, receipts: [], legacy: true };
  }
  if (value.version !== SYNC_PROTOCOL || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new Error('unsupported or invalid state envelope');
  }
  if (!isObject(value.state)) throw new Error('invalid state envelope payload');
  return {
    state: value.state,
    revision: value.revision,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : null,
    receipts: Array.isArray(value.receipts) ? value.receipts.filter(receipt => (
      isObject(receipt) && typeof receipt.clientId === 'string' &&
      typeof receipt.mutationId === 'string' && typeof receipt.payloadHash === 'string' &&
      Number.isSafeInteger(receipt.revision) && receipt.revision > 0 &&
      receipt.revision <= value.revision
    )) : [],
    legacy: false
  };
}

function encodeStoredState(record) {
  return {
    format: STATE_ENVELOPE_FORMAT,
    version: SYNC_PROTOCOL,
    revision: record.revision,
    updatedAt: record.updatedAt,
    state: record.state,
    receipts: record.receipts
  };
}

function defaultAtomicWrite(file, content) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

export function createStateStore({
  dataDir,
  maxReceipts = DEFAULT_MAX_RECEIPTS,
  now = () => Date.now(),
  atomicWrite = defaultAtomicWrite
}) {
  if (!dataDir) throw new Error('dataDir required');
  if (!Number.isSafeInteger(maxReceipts) || maxReceipts < 1) throw new Error('maxReceipts must be positive');

  const fileFor = uid => path.join(dataDir, `state-${String(uid).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);

  function readRecord(uid) {
    try {
      return decodeStoredState(JSON.parse(fs.readFileSync(fileFor(uid), 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRecord();
      throw error;
    }
  }

  function readState(uid) {
    return readRecord(uid).state;
  }

  function putState(uid, input) {
    if (!isObject(input)) throw new StateStoreError(400, 'invalid_request', 'request body required');
    const baseRevision = input.baseRevision;
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
      throw new StateStoreError(400, 'invalid_request', 'baseRevision must be a non-negative integer');
    }
    const clientId = cleanIdentifier(input.clientId, 'clientId');
    const mutationId = cleanIdentifier(input.mutationId, 'mutationId');
    const state = canonicalServerState(input.state);
    const hash = payloadHash(baseRevision, state);
    const current = readRecord(uid);
    const receipt = current.receipts.find(item => item.clientId === clientId && item.mutationId === mutationId);

    // Check the receipt before CAS: a response may have been lost and other devices may have
    // advanced the document meanwhile. The original mutation is still acknowledged exactly once.
    if (receipt) {
      if (receipt.payloadHash !== hash) {
        throw new StateStoreError(409, 'mutation_id_reused', 'mutationId was already used for different data', {
          revision: current.revision
        });
      }
      return { revision: receipt.revision, mutationId, idempotent: true };
    }

    if (baseRevision !== current.revision) {
      throw new StateStoreError(412, 'revision_conflict', 'state revision changed', {
        state: current.state,
        revision: current.revision
      });
    }
    if (current.revision >= Number.MAX_SAFE_INTEGER) {
      throw new StateStoreError(507, 'revision_exhausted', 'state revision cannot be advanced');
    }

    const revision = current.revision + 1;
    const receipts = [...current.receipts, { clientId, mutationId, payloadHash: hash, revision }]
      .slice(-maxReceipts);
    const next = { state, revision, updatedAt: now(), receipts };
    atomicWrite(fileFor(uid), JSON.stringify(encodeStoredState(next)));
    return { revision, mutationId, idempotent: false };
  }

  return { fileFor, readRecord, readState, putState };
}
