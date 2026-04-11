import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createExplorerServer } from '../src/server/api.js';
import { createSession } from '../src/core/state.js';
import { saveSnapshot } from '../src/core/snapshot.js';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body });
      });
    }).on('error', reject);
  });
}

describe('explorer api', () => {
  /** @type {string} */
  let tmpDir;
  /** @type {import('node:http').Server} */
  let server;
  /** @type {number} */
  let port;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-explorer-'));
    const s = createSession('api-sess', tmpDir);
    s.goal = 'API test goal';
    await saveSnapshot(s);
    server = await createExplorerServer(tmpDir);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(undefined));
    });
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/sessions returns session list', async () => {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/api/sessions`);
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].sessionId).toBe('api-sess');
    expect(data[0].goal).toBe('API test goal');
  });

  it('GET / serves HTML', async () => {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
    expect(body).toContain('Picklejar Explorer');
  });
});
