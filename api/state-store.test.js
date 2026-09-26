import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  canonicalServerState,
  createStateStore,
  STATE_ENVELOPE_FORMAT,
  StateStoreError,
  SYNC_PROTOCOL
} from './state-store.js';

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-state-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

function newStore(options = {}) {
  return createStateStore({ dataDir: temporaryDirectory(), now: () => 1_725_000_000_000, ...options });
}

function expectStoreError(action, status, code) {
  assert.throws(action, error => {
    assert.ok(error instanceof StateStoreError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}

afterEach(() => {
  while (temporaryDirectories.length) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('state store', () => {
  it('represents an account without a state file as revision zero', () => {
    const store = newStore();

    assert.deepEqual(store.readRecord('new-user'), {
      state: null,
      revision: 0,
      updatedAt: null,
      receipts: [],
      legacy: false
    });
    assert.equal(store.readState('new-user'), null);
  });

  it('reads a legacy raw JSON state unchanged and migrates it only on the first valid write', () => {
    const store = newStore();
    const legacy = { workouts: [{ id: 'old' }], active: { step: 2 }, _ts: 1234 };
    fs.writeFileSync(store.fileFor('legacy-user'), JSON.stringify(legacy));

    assert.deepEqual(store.readRecord('legacy-user'), {
      state: legacy,
      revision: 0,
      updatedAt: 1234,
      receipts: [],
      legacy: true
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(store.fileFor('legacy-user'), 'utf8')), legacy);

    const result = store.putState('legacy-user', {
      state: legacy,
      baseRevision: 0,
      clientId: 'phone',
      mutationId: 'migrate-1'
    });

    assert.deepEqual(result, { revision: 1, mutationId: 'migrate-1', idempotent: false });
    const persisted = JSON.parse(fs.readFileSync(store.fileFor('legacy-user'), 'utf8'));
    assert.equal(persisted.format, STATE_ENVELOPE_FORMAT);
    assert.equal(persisted.version, SYNC_PROTOCOL);
    assert.equal(persisted.revision, 1);
    assert.deepEqual(persisted.state, { workouts: [{ id: 'old' }] });
    assert.equal(store.readRecord('legacy-user').legacy, false);
  });

  it('increments revisions monotonically and strips device/sync-only top-level fields', () => {
    const store = newStore();
    const first = store.putState('user', {
      state: { routines: [{ id: 'r1' }], active: { routineId: 'r1' }, _ts: 99 },
      baseRevision: 0,
      clientId: 'phone',
      mutationId: 'm1'
    });
    const second = store.putState('user', {
      state: { routines: [{ id: 'r1' }, { id: 'r2' }] },
      baseRevision: 1,
      clientId: 'phone',
      mutationId: 'm2'
    });

    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.deepEqual(store.readState('user'), { routines: [{ id: 'r1' }, { id: 'r2' }] });
    assert.equal(store.readRecord('user').updatedAt, 1_725_000_000_000);
  });

  it('rejects stale compare-and-swap writes without changing the accepted state', () => {
    const store = newStore();
    store.putState('user', {
      state: { unit: 'kg' }, baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    });

    assert.throws(() => store.putState('user', {
      state: { unit: 'lb' }, baseRevision: 0, clientId: 'tablet', mutationId: 'm2'
    }), error => {
      assert.ok(error instanceof StateStoreError);
      assert.equal(error.status, 412);
      assert.equal(error.code, 'revision_conflict');
      assert.equal(error.details.revision, 1);
      assert.deepEqual(error.details.state, { unit: 'kg' });
      return true;
    });
    assert.deepEqual(store.readState('user'), { unit: 'kg' });
    assert.equal(store.readRecord('user').revision, 1);
  });

  it('acknowledges an identical retry exactly once even after a later mutation', () => {
    const store = newStore();
    const original = {
      state: { settings: { locale: 'it' }, workouts: [] },
      baseRevision: 0,
      clientId: 'phone',
      mutationId: 'm1'
    };
    store.putState('user', original);
    store.putState('user', {
      state: { settings: { locale: 'it' }, workouts: [{ id: 'w1' }] },
      baseRevision: 1,
      clientId: 'tablet',
      mutationId: 'm2'
    });

    // Object key order does not alter the semantic idempotency hash.
    const retry = store.putState('user', {
      mutationId: 'm1', clientId: 'phone', baseRevision: 0,
      state: { workouts: [], settings: { locale: 'it' } }
    });

    assert.deepEqual(retry, { revision: 1, mutationId: 'm1', idempotent: true });
    assert.equal(store.readRecord('user').revision, 2);
    assert.deepEqual(store.readState('user').workouts, [{ id: 'w1' }]);
  });

  it('retains revisions and idempotency receipts across store/server restarts', () => {
    const directory = temporaryDirectory();
    const firstProcess = createStateStore({ dataDir: directory, now: () => 100 });
    const mutation = {
      state: { routines: [{ id: 'r1' }] },
      baseRevision: 0,
      clientId: 'phone',
      mutationId: 'm1'
    };
    firstProcess.putState('user', mutation);

    const restartedProcess = createStateStore({ dataDir: directory, now: () => 200 });
    assert.equal(restartedProcess.readRecord('user').revision, 1);
    assert.deepEqual(restartedProcess.putState('user', mutation), {
      revision: 1, mutationId: 'm1', idempotent: true
    });
    assert.equal(restartedProcess.readRecord('user').updatedAt, 100);
  });

  it('rejects reuse of the same mutation identity for different data', () => {
    const store = newStore();
    store.putState('user', {
      state: { unit: 'kg' }, baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    });

    expectStoreError(() => store.putState('user', {
      state: { unit: 'lb' }, baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    }), 409, 'mutation_id_reused');
  });

  it('bounds persisted receipts while retaining recent retry protection', () => {
    const store = newStore({ maxReceipts: 2 });
    for (let index = 0; index < 3; index += 1) {
      store.putState('user', {
        state: { value: index }, baseRevision: index,
        clientId: 'phone', mutationId: `m${index}`
      });
    }

    const record = store.readRecord('user');
    assert.deepEqual(record.receipts.map(receipt => receipt.mutationId), ['m1', 'm2']);
    expectStoreError(() => store.putState('user', {
      state: { value: 0 }, baseRevision: 0, clientId: 'phone', mutationId: 'm0'
    }), 412, 'revision_conflict');
  });

  it('validates protocol fields before touching storage', () => {
    const store = newStore();
    expectStoreError(() => store.putState('user', {
      state: {}, baseRevision: -1, clientId: 'phone', mutationId: 'm1'
    }), 400, 'invalid_request');
    expectStoreError(() => store.putState('user', {
      state: [], baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    }), 400, 'invalid_request');
    expectStoreError(() => store.putState('user', {
      state: {}, baseRevision: 0, clientId: '', mutationId: 'm1'
    }), 400, 'invalid_request');
    expectStoreError(() => store.putState('user', {
      state: {}, baseRevision: 0, clientId: 'phone', mutationId: ''
    }), 400, 'invalid_request');
    assert.equal(fs.existsSync(store.fileFor('user')), false);
  });

  it('does not mutate the caller state while canonicalizing it', () => {
    const input = {
      active: { step: 1 }, _ts: 9, _sync: {}, __syncAttempt: 2,
      sync: {}, syncMeta: {}, syncMetadata: {}, routines: []
    };
    assert.deepEqual(canonicalServerState(input), { routines: [] });
    assert.deepEqual(input, {
      active: { step: 1 }, _ts: 9, _sync: {}, __syncAttempt: 2,
      sync: {}, syncMeta: {}, syncMetadata: {}, routines: []
    });
  });

  it('fails closed on corrupt files instead of treating them as an empty account', () => {
    const store = newStore();
    fs.writeFileSync(store.fileFor('user'), '{not-json');
    assert.throws(() => store.readRecord('user'), SyntaxError);
    assert.throws(() => store.putState('user', {
      state: {}, baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    }), SyntaxError);
  });

  it('does not claim a revision when the atomic write fails', () => {
    const directory = temporaryDirectory();
    const store = createStateStore({
      dataDir: directory,
      atomicWrite: () => { throw new Error('disk full'); }
    });

    assert.throws(() => store.putState('user', {
      state: { unit: 'kg' }, baseRevision: 0, clientId: 'phone', mutationId: 'm1'
    }), /disk full/);
    assert.deepEqual(store.readRecord('user'), {
      state: null, revision: 0, updatedAt: null, receipts: [], legacy: false
    });
  });
});
