import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const API_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'docker-packaging-test-secret';
const USER_ID = 'packaging-user';
const STATE = { workouts: [{ id: 'offline-workout', date: '2026-09-29', exercises: [] }] };
let stagingDirectory;
let dataDirectory;
let baseUrl;
let child;
let childOutput = '';
let spawnError;

// Stage only the files COPY actually includes, not a hand-maintained list that
// could accidentally hide a missing runtime module. This is deliberately NOT a
// Docker emulator: unsupported COPY syntax must fail instead of being ignored.
function stageDockerFiles() {
  const dockerfile = fs.readFileSync(path.join(API_DIRECTORY, 'Dockerfile'), 'utf8');
  const lines = dockerfile.split(/\r?\n/).map(line => line.trim());
  assert.equal(lines.filter(line => /^FROM\s/i.test(line)).length, 1,
    'Extend the staging helper before using a multi-stage API image');
  assert.deepEqual(lines.filter(line => /^WORKDIR\s/i.test(line)), ['WORKDIR /app']);
  assert.deepEqual(lines.filter(line => /^CMD\s/i.test(line)), ['CMD ["node", "server.js"]']);
  const copies = lines.filter(line => /^COPY\s/i.test(line));
  assert.ok(copies.length > 0, 'Dockerfile must declare its runtime files');
  for (const line of copies) {
    const [, ...tokens] = line.trim().split(/\s+/);
    assert.equal(tokens.pop(), './', `Extend the staging helper for this COPY destination: ${line}`);
    assert.ok(tokens.length > 0, `Missing COPY sources: ${line}`);
    for (const source of tokens) {
      assert.match(source, /^[\w.*-]+$/, `Extend the staging helper for this COPY source: ${source}`);
      const pattern = new RegExp(`^${source.split('*').map(part => part.replace(/\./g, '\\.')).join('.*')}$`);
      const matches = fs.readdirSync(API_DIRECTORY).filter(name => pattern.test(name));
      assert.ok(matches.length > 0, `COPY source does not exist: ${source}`);
      for (const name of matches) {
        const sourcePath = path.join(API_DIRECTORY, name);
        assert.ok(fs.statSync(sourcePath).isFile(), `Only file COPY is supported: ${name}`);
        fs.copyFileSync(sourcePath, path.join(stagingDirectory, name));
      }
    }
  }
}

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

function cookie() {
  const payload = `${USER_ID}:${Date.now() + 60_000}:0`;
  const signature = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${signature}`;
}

function request(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(3_000),
    headers: { Cookie: cookie(), 'Content-Type': 'application/json', ...options.headers }
  });
}

async function startServer() {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  childOutput = '';
  spawnError = undefined;
  child = spawn(process.execPath, ['server.js'], {
    cwd: stagingDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DATA_DIR: dataDirectory,
      RP_ID: 'localhost',
      ORIGIN: baseUrl,
      VAPID_SUBJECT: 'mailto:packaging-test@localhost'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.on('error', error => { spawnError = error; });
  child.stdout.on('data', chunk => { childOutput += chunk; });
  child.stderr.on('data', chunk => { childOutput += chunk; });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Docker-staged API failed to start (${child.exitCode}): ${childOutput}`);
    }
    try {
      const response = await request('/api/health');
      await response.text();
      if (response.ok) return;
    } catch { /* Startup can briefly precede the listening socket. */ }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Docker-staged API startup timed out: ${childOutput}`);
}

async function stopServer() {
  if (child && !spawnError && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
  }
}

describe('API runtime files declared by Dockerfile', { concurrency: false }, () => {
  before(async () => {
    // A child folder lets third-party packages resolve from api/node_modules on
    // Windows without symlinks/admin rights. Relative application imports still
    // resolve ONLY inside staging: a missing ./state-store.js cannot be masked.
    stagingDirectory = fs.mkdtempSync(path.join(API_DIRECTORY, '.packaging-test-'));
    stageDockerFiles();
    dataDirectory = path.join(stagingDirectory, 'test-data');
    fs.mkdirSync(dataDirectory);
    fs.writeFileSync(path.join(dataDirectory, 'secret'), SECRET);
    fs.writeFileSync(path.join(dataDirectory, 'db.json'), JSON.stringify({
      users: [{ id: USER_ID, name: 'Packaging Test' }], creds: [], subs: [], invites: []
    }));
    await startServer();
  });

  after(async () => {
    await stopServer();
    if (stagingDirectory) {
      assert.equal(path.dirname(stagingDirectory), API_DIRECTORY);
      assert.ok(path.basename(stagingDirectory).startsWith('.packaging-test-'));
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    }
  });

  it('boots the packaged server and retains authentication protection', async () => {
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
    const unauthorized = await request('/api/data', { headers: { Cookie: '' } });
    assert.equal(unauthorized.status, 401);
    await unauthorized.text();
  });

  it('synchronizes an offline workout with revisions, idempotency and stale-write protection', async () => {
    const initial = await request('/api/data');
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('x-opengym-sync-protocol'), '1');
    assert.deepEqual(await initial.json(), { state: null, revision: 0, syncProtocol: 1 });

    const mutation = { state: STATE, baseRevision: 0, clientId: 'phone', mutationId: 'pending-1' };
    const write = await request('/api/data', { method: 'PUT', body: JSON.stringify(mutation) });
    assert.equal(write.status, 200);
    assert.deepEqual(await write.json(), {
      ok: true, revision: 1, mutationId: 'pending-1', idempotent: false, syncProtocol: 1
    });
    const retry = await request('/api/data', { method: 'PUT', body: JSON.stringify(mutation) });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      ok: true, revision: 1, mutationId: 'pending-1', idempotent: true, syncProtocol: 1
    });
    const stale = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({ ...mutation, mutationId: 'stale-2', state: { workouts: [] } })
    });
    assert.equal(stale.status, 412);
    await stale.text();
    const read = await request('/api/data');
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { state: STATE, revision: 1, syncProtocol: 1 });
  });

  it('retains the workout, revision and retry receipt after process restart', async () => {
    await stopServer();
    await startServer();
    const read = await request('/api/data');
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { state: STATE, revision: 1, syncProtocol: 1 });
    const retry = await request('/api/data', {
      method: 'PUT',
      body: JSON.stringify({ state: STATE, baseRevision: 0, clientId: 'phone', mutationId: 'pending-1' })
    });
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), {
      ok: true, revision: 1, mutationId: 'pending-1', idempotent: true, syncProtocol: 1
    });
  });
});
