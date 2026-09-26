import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const API_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'backend-integration-test-secret';
const USER_ID = 'integration-user';
const LEGACY_USER_ID = 'legacy-user';
const RACE_USER_ID = 'race-user';
let child;
let dataDirectory;
let baseUrl;
let cookie;
let childOutput = '';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function signedCookie(userId = USER_ID) {
  const payload = `${userId}:${Date.now() + 60_000}:0`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${signature}`;
}

async function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (child?.exitCode !== null) throw new Error(`API exited with ${child.exitCode}: ${childOutput}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`API did not start (${lastError?.message || 'unknown error'}): ${childOutput}`);
}

describe('revisioned /api/data protocol', () => {
  before(async () => {
    dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-sync-api-'));
    fs.writeFileSync(path.join(dataDirectory, 'secret'), SECRET);
    fs.writeFileSync(path.join(dataDirectory, 'db.json'), JSON.stringify({
      users: [
        { id: USER_ID, name: 'Integration User' },
        { id: LEGACY_USER_ID, name: 'Legacy User' },
        { id: RACE_USER_ID, name: 'Race User' }
      ],
      creds: [], subs: [], invites: []
    }));
    fs.writeFileSync(path.join(dataDirectory, `state-${LEGACY_USER_ID}.json`), JSON.stringify({
      unit: 'kg', workouts: [{ id: 'legacy-workout' }], _ts: 123
    }));
    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    cookie = signedCookie();
    child = spawn(process.execPath, ['server.js'], {
      cwd: API_DIRECTORY,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: dataDirectory,
        RP_ID: 'localhost',
        ORIGIN: baseUrl
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { childOutput += chunk; });
    child.stderr.on('data', chunk => { childOutput += chunk; });
    await waitForServer();
  });

  after(async () => {
    if (child?.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
  });

  it('exposes revision zero and protocol metadata for a new account', async () => {
    const response = await request('/api/data');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), '"opengym-state-0"');
    assert.equal(response.headers.get('x-opengym-sync-protocol'), '1');
    assert.deepEqual(await response.json(), { state: null, revision: 0, syncProtocol: 1 });
  });

  it('serves a legacy raw JSON file as revision zero without rewriting it', async () => {
    const response = await request('/api/data', {
      headers: { Cookie: signedCookie(LEGACY_USER_ID) }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      state: { unit: 'kg', workouts: [{ id: 'legacy-workout' }], _ts: 123 },
      revision: 0,
      syncProtocol: 1
    });
    assert.equal(JSON.parse(fs.readFileSync(
      path.join(dataDirectory, `state-${LEGACY_USER_ID}.json`), 'utf8'
    )).format, undefined);
  });

  it('persists one mutation and returns its durable revision', async () => {
    const response = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({
        state: { workouts: [{ id: 'w1' }], active: { step: 3 }, _ts: 44 },
        baseRevision: 0,
        clientId: 'phone',
        mutationId: 'm1'
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true, revision: 1, mutationId: 'm1', idempotent: false, syncProtocol: 1
    });

    const read = await request('/api/data');
    assert.deepEqual(await read.json(), {
      state: { workouts: [{ id: 'w1' }] }, revision: 1, syncProtocol: 1
    });
  });

  it('returns the current snapshot on stale CAS and idempotently acknowledges a retry', async () => {
    const stale = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({
        state: { workouts: [{ id: 'other' }] },
        baseRevision: 0,
        clientId: 'tablet',
        mutationId: 'm2'
      })
    });
    assert.equal(stale.status, 412);
    assert.deepEqual(await stale.json(), {
      error: 'revision_conflict',
      message: 'state revision changed',
      state: { workouts: [{ id: 'w1' }] },
      revision: 1,
      syncProtocol: 1
    });

    const retry = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({
        state: { _ts: 999, active: null, workouts: [{ id: 'w1' }] },
        baseRevision: 0,
        clientId: 'phone',
        mutationId: 'm1'
      })
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      ok: true, revision: 1, mutationId: 'm1', idempotent: true, syncProtocol: 1
    });
  });

  it('rejects malformed protocol requests without replacing server data', async () => {
    const invalid = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({ state: { workouts: [] }, clientId: 'phone', mutationId: 'm3' })
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'invalid_request');

    const read = await request('/api/data');
    assert.equal((await read.json()).revision, 1);
  });

  it('rejects an oversized state with 413 without acknowledging or replacing it', async () => {
    const oversized = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({
        state: { note: 'x'.repeat((5 * 1024 * 1024) + 1) },
        baseRevision: 1,
        clientId: 'phone',
        mutationId: 'oversized'
      })
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).error, 'payload_too_large');

    const read = await request('/api/data');
    const current = await read.json();
    assert.equal(current.revision, 1);
    assert.deepEqual(current.state, { workouts: [{ id: 'w1' }] });
  });

  it('accepts exactly one of two concurrent writes based on the same revision', async () => {
    const raceCookie = signedCookie(RACE_USER_ID);
    const mutation = id => request('/api/data', {
      method: 'PUT',
      headers: { Cookie: raceCookie },
      body: JSON.stringify({
        state: { winner: id }, baseRevision: 0, clientId: id, mutationId: `mutation-${id}`
      })
    });
    const responses = await Promise.all([mutation('phone'), mutation('tablet')]);
    assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);

    const read = await request('/api/data', { headers: { Cookie: raceCookie } });
    const body = await read.json();
    assert.equal(body.revision, 1);
    assert.ok(['phone', 'tablet'].includes(body.state.winner));
  });
});
