import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSessions, loadSessionDetail, getSessionViewModel } from '../core/sessions.js';
import { compileHumanSummary } from '../core/human-summary.js';
import { compileBrainDump, listSelectableActions } from '../core/compiler.js';
import { loadConfig } from '../core/config.js';
import { openSessionInAgent, buildHandoffDumpOptions } from '../core/resume-service.js';
import { AGENT_IDS } from '../agents/registry.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const markedPath = path.join(path.dirname(require.resolve('marked/package.json')), 'lib/marked.umd.js');
const purifyPath = path.join(path.dirname(require.resolve('dompurify')), 'purify.min.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const faviconPath = path.join(__dirname, '../explorer/picklejar.ico');
const MAX_JSON_BODY_BYTES = 64 * 1024;
const COMMON_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const HTML_HEADERS = {
  ...COMMON_HEADERS,
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Frame-Options': 'DENY',
};

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} code
 * @param {unknown} data
 */
function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...COMMON_HEADERS,
  });
  res.end(JSON.stringify(data));
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} code
 * @param {string} html
 */
function sendHTML(res, code, html) {
  res.writeHead(code, {
    'Content-Type': 'text/html; charset=utf-8',
    ...HTML_HEADERS,
  });
  res.end(html);
}

/**
 * @param {string} html
 * @param {object} bootstrap
 */
function injectExplorerBootstrap(html, bootstrap) {
  const script = `<script>window.__PICKLEJAR_EXPLORER__=${serializeForInlineScript(bootstrap)};</script>`;
  return html.replace('<script src="/vendor/marked.js"></script>', `${script}\n  <script src="/vendor/marked.js"></script>`);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 */
function requestToken(req, url) {
  const header = req.headers['x-picklejar-explorer-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return url.searchParams.get('token')?.trim() || '';
}

/**
 * @param {string} token
 * @param {import('node:http').IncomingMessage} req
 * @param {URL} url
 */
function tokenMatches(token, req, url) {
  if (!token) return true;
  return requestToken(req, url) === token;
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
async function readJsonBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @typedef {object} ExplorerOpenRequest
 * @property {string} projectDir
 * @property {string} sessionId
 * @property {string} agent
 * @property {number} maxTokens
 * @property {ReturnType<typeof buildHandoffDumpOptions>} brainDumpOpts
 * @property {import('../types/index.d.ts').PicklejarSession} session
 */

/**
 * @typedef {object} ExplorerEphemeralOptions
 * @property {string} token
 * @property {number} [heartbeatMs]
 * @property {number} [idleTimeoutMs]
 * @property {number} [closeGraceMs]
 * @property {(reason: string) => void | Promise<void>} [onShutdown]
 */

/**
 * @param {string} projectDir
 * @param {{ onOpenRequest?: (request: ExplorerOpenRequest) => void | Promise<void>, ephemeral?: ExplorerEphemeralOptions }} [options]
 * @returns {Promise<import('node:http').Server>}
 */
export async function createExplorerServer(projectDir, options = {}) {
  const { onOpenRequest, ephemeral } = options;
  const explorerHtmlPath = path.join(__dirname, '../explorer/index.html');
  const explorerHtmlRaw = await fs.readFile(explorerHtmlPath, 'utf8');
  const heartbeatMs = ephemeral?.heartbeatMs ?? 15_000;
  const idleTimeoutMs = ephemeral?.idleTimeoutMs ?? 45_000;
  const closeGraceMs = ephemeral?.closeGraceMs ?? 1_500;
  const explorerHtml = injectExplorerBootstrap(explorerHtmlRaw, {
    ephemeral: Boolean(ephemeral?.token),
    token: ephemeral?.token || '',
    heartbeatMs,
    idleTimeoutMs,
  });
  const activeClients = new Map();
  let lastActivityAt = Date.now();
  let idleTimer = null;
  let nextShutdownAt = ephemeral ? Date.now() + idleTimeoutMs : null;
  let shuttingDown = false;

  const shutdownExplorer = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (idleTimer) clearTimeout(idleTimer);
    server.close(async () => {
      await ephemeral?.onShutdown?.(reason);
    });
  };

  const scheduleLifecycleCheck = () => {
    if (!ephemeral || shuttingDown) return;
    if (idleTimer) clearTimeout(idleTimer);
    const now = Date.now();

    for (const [clientId, seenAt] of activeClients) {
      if (now - seenAt >= idleTimeoutMs) {
        activeClients.delete(clientId);
      }
    }
    if (activeClients.size === 0 && nextShutdownAt == null) {
      nextShutdownAt = now + closeGraceMs;
    }

    const deadlines = [];
    if (nextShutdownAt != null) deadlines.push(nextShutdownAt);
    if (activeClients.size > 0) {
      const oldestClientAt = Math.min(...activeClients.values());
      deadlines.push(oldestClientAt + idleTimeoutMs);
    }
    if (deadlines.length === 0) return;

    const delay = Math.max(25, Math.min(...deadlines) - now);
    idleTimer = setTimeout(() => {
      const checkNow = Date.now();
      for (const [clientId, seenAt] of activeClients) {
        if (checkNow - seenAt >= idleTimeoutMs) {
          activeClients.delete(clientId);
        }
      }
      if (activeClients.size === 0 && nextShutdownAt == null) {
        nextShutdownAt = checkNow + closeGraceMs;
      }
      if (nextShutdownAt != null && checkNow >= nextShutdownAt && activeClients.size === 0) {
        void shutdownExplorer('idle');
        return;
      }
      scheduleLifecycleCheck();
    }, delay);
    idleTimer.unref?.();
  };

  const noteServerActivity = () => {
    if (!ephemeral) return;
    lastActivityAt = Date.now();
    if (activeClients.size === 0) {
      nextShutdownAt = lastActivityAt + idleTimeoutMs;
    }
    scheduleLifecycleCheck();
  };

  const noteClientHeartbeat = (clientId) => {
    if (!ephemeral) return;
    const now = Date.now();
    lastActivityAt = now;
    activeClients.set(clientId, now);
    nextShutdownAt = null;
    scheduleLifecycleCheck();
  };

  const noteClientClosed = (clientId) => {
    if (!ephemeral) return;
    lastActivityAt = Date.now();
    activeClients.delete(clientId);
    if (activeClients.size === 0) {
      nextShutdownAt = Date.now() + closeGraceMs;
    }
    scheduleLifecycleCheck();
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        Allow: 'GET, POST, OPTIONS',
        ...COMMON_HEADERS,
      });
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      sendJSON(res, 400, { error: 'Bad request' });
      return;
    }
    const p = url.pathname;

    try {
      if (ephemeral?.token && (p === '/' || p === '/index.html' || p.startsWith('/api/'))) {
        if (!tokenMatches(ephemeral.token, req, url)) {
          sendJSON(res, 403, { error: 'Explorer session expired' });
          return;
        }
      }

      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        noteServerActivity();
        sendHTML(res, 200, explorerHtml);
        return;
      }

      if (req.method === 'GET' && (p === '/favicon.ico' || p === '/picklejar.ico')) {
        const data = await fs.readFile(faviconPath);
        res.writeHead(200, {
          'Content-Type': 'image/x-icon',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(data);
        return;
      }

      if (req.method === 'GET' && p === '/vendor/marked.js') {
        const data = await fs.readFile(markedPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          ...COMMON_HEADERS,
        });
        res.end(data);
        return;
      }

      if (req.method === 'GET' && p === '/vendor/dompurify.js') {
        const data = await fs.readFile(purifyPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          ...COMMON_HEADERS,
        });
        res.end(data);
        return;
      }

      if (req.method === 'POST' && p === '/api/explorer/heartbeat') {
        const body = await readJsonBody(req);
        if (body === null) {
          sendJSON(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
        if (!clientId) {
          sendJSON(res, 400, { error: 'Missing clientId' });
          return;
        }
        noteClientHeartbeat(clientId);
        sendJSON(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && p === '/api/explorer/close') {
        const body = await readJsonBody(req);
        if (body === null) {
          sendJSON(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
        noteClientClosed(clientId);
        res.once('finish', () => {
          if (ephemeral && activeClients.size === 0) {
            const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'close';
            setTimeout(() => {
              if (!shuttingDown && activeClients.size === 0) {
                void shutdownExplorer(reason);
              }
            }, closeGraceMs);
          }
        });
        sendJSON(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && p === '/api/sessions') {
        noteServerActivity();
        const sessions = await listSessions(projectDir);
        sendJSON(res, 200, sessions);
        return;
      }

      let m = /^\/api\/sessions\/([^/]+)\/summary$/.exec(p);
      if (m && req.method === 'GET') {
        noteServerActivity();
        const id = decodeURIComponent(m[1]);
        const session = await loadSessionDetail(projectDir, id);
        if (!session) {
          sendJSON(res, 404, { error: 'Not found' });
          return;
        }
        const cfg = await loadConfig(projectDir);
        const humanSummary = compileHumanSummary(session);
        const handoffSummary = compileBrainDump(session, { maxTokens: cfg.maxTokens });
        sendJSON(res, 200, { humanSummary, handoffSummary });
        return;
      }

      m = /^\/api\/sessions\/([^/]+)\/actions$/.exec(p);
      if (m && req.method === 'GET') {
        noteServerActivity();
        const id = decodeURIComponent(m[1]);
        const session = await loadSessionDetail(projectDir, id);
        if (!session) {
          sendJSON(res, 404, { error: 'Not found' });
          return;
        }
        sendJSON(res, 200, listSelectableActions(session));
        return;
      }

      m = /^\/api\/sessions\/([^/]+)\/open$/.exec(p);
      if (m && req.method === 'POST') {
        noteServerActivity();
        const id = decodeURIComponent(m[1]);
        const body = await readJsonBody(req);
        if (body === null) {
          sendJSON(res, 400, { error: 'Invalid JSON body' });
          return;
        }
        const agent = body.agent;
        const profile = typeof body.profile === 'string' ? body.profile : 'balanced';
        const exclude = Array.isArray(body.exclude) ? body.exclude : [];
        if (!agent || typeof agent !== 'string') {
          sendJSON(res, 400, { error: 'Missing agent' });
          return;
        }
        if (!AGENT_IDS.includes(agent)) {
          sendJSON(res, 400, { error: 'Unknown agent' });
          return;
        }
        const session = await loadSessionDetail(projectDir, id);
        if (!session) {
          sendJSON(res, 404, { error: 'Not found' });
          return;
        }
        const cfg = await loadConfig(projectDir);
        const brainDumpOpts = buildHandoffDumpOptions({ profile, exclude });
        if (onOpenRequest) {
          const request = {
            projectDir,
            sessionId: id,
            agent,
            maxTokens: cfg.maxTokens,
            brainDumpOpts,
            session,
          };
          res.once('finish', () => {
            Promise.resolve(onOpenRequest(request)).catch((err) => {
              console.error(String(err?.message || err));
            });
          });
          sendJSON(res, 200, { success: true, agent, terminalHandoff: true });
          return;
        }
        await openSessionInAgent({
          projectDir,
          sessionId: id,
          agent,
          maxTokens: cfg.maxTokens,
          brainDumpOpts,
          session,
          detachSpawn: true,
        });
        sendJSON(res, 200, { success: true, agent });
        return;
      }

      m = /^\/api\/sessions\/([^/]+)$/.exec(p);
      if (m && req.method === 'GET') {
        noteServerActivity();
        const id = decodeURIComponent(m[1]);
        const vm = await getSessionViewModel(projectDir, id);
        if (!vm) {
          sendJSON(res, 404, { error: 'Not found' });
          return;
        }
        sendJSON(res, 200, vm);
        return;
      }

      sendJSON(res, 404, { error: 'Not found' });
    } catch (e) {
      const err = /** @type {Error & { statusCode?: number }} */ (e);
      if (err.statusCode) {
        sendJSON(res, err.statusCode, { error: err.message });
        return;
      }
      console.error('[picklejar explorer]', err);
      sendJSON(res, 500, { error: 'Internal server error' });
    }
  });
  server.on('close', () => {
    shuttingDown = true;
    if (idleTimer) clearTimeout(idleTimer);
  });

  scheduleLifecycleCheck();

  return server;
}
