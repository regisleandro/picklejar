import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function httpPost(url, payload) {
  return httpRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof options.body === 'string' ? options.body : '';
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          ...(options.headers || {}),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (c) => {
          responseBody += c;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
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
    if (server?.listening) {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
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
    expect(data[0].sessionInsights).toBeDefined();
    expect(typeof data[0].sessionInsights.qualityScore).toBe('number');
  });

  it('GET /api/analytics returns agent aggregates', async () => {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/api/analytics?window=all`);
    expect(status).toBe(200);
    const data = JSON.parse(body);
    expect(Array.isArray(data.agents)).toBe(true);
    expect(data.window).toBeDefined();
    expect(data.window.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it('GET / serves HTML', async () => {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
    expect(body).toContain('Picklejar Explorer');
    expect(body).toContain('app-header');
    expect(body).toContain('main-column');
    expect(body).toContain('Picklejar Explorer</h1>');
    expect(body).toContain('data-theme="dark"');
    expect(body).toContain('id="theme-toggle-group"');
    expect(body).toContain('href="/favicon.ico"');
  });

  it('GET /favicon.ico serves the packaged icon', async () => {
    const { status, body } = await httpGet(`http://127.0.0.1:${port}/favicon.ico`);
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
  });

  it('POST /api/sessions/:id/open delegates terminal handoff when callback is provided', async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    const onOpenRequest = vi.fn().mockResolvedValue(undefined);
    server = await createExplorerServer(tmpDir, { onOpenRequest });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(undefined));
    });
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

    const { status, body } = await httpPost(`http://127.0.0.1:${port}/api/sessions/api-sess/open`, {
      agent: 'claude',
      profile: 'strict',
      exclude: ['history'],
    });

    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ success: true, agent: 'claude', terminalHandoff: true });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(onOpenRequest).toHaveBeenCalledTimes(1);
    expect(onOpenRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectDir: tmpDir,
        sessionId: 'api-sess',
        agent: 'claude',
        maxTokens: expect.any(Number),
        brainDumpOpts: expect.objectContaining({
          curationProfile: 'strict',
          sections: expect.objectContaining({ summarizedHistory: false }),
        }),
      }),
    );
  });

  it('ephemeral explorer requires token and closes after close beacon', async () => {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
    const shutdownReasons = [];
    server = await createExplorerServer(tmpDir, {
      ephemeral: {
        token: 'secret-token',
        closeGraceMs: 10,
        idleTimeoutMs: 50,
        onShutdown: async (reason) => {
          shutdownReasons.push(reason);
        },
      },
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(undefined));
    });
    port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;

    const denied = await httpGet(`http://127.0.0.1:${port}/`);
    expect(denied.status).toBe(403);

    const allowed = await httpGet(`http://127.0.0.1:${port}/?token=secret-token`);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toContain('secret-token');

    const heartbeat = await httpRequest(`http://127.0.0.1:${port}/api/explorer/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-picklejar-explorer-token': 'secret-token',
      },
      body: JSON.stringify({ clientId: 'tab-1' }),
    });
    expect(heartbeat.status).toBe(200);

    const close = await httpPost(`http://127.0.0.1:${port}/api/explorer/close?token=secret-token`, {
      clientId: 'tab-1',
      reason: 'pagehide',
    });
    expect(close.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(shutdownReasons).toEqual(['pagehide']);
    expect(server.listening).toBe(false);
  });
});
