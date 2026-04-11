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

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} code
 * @param {unknown} data
 */
function sendJSON(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(),
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
    ...corsHeaders(),
  });
  res.end(html);
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} projectDir
 * @returns {Promise<import('node:http').Server>}
 */
export async function createExplorerServer(projectDir) {
  const explorerHtmlPath = path.join(__dirname, '../explorer/index.html');
  const explorerHtml = await fs.readFile(explorerHtmlPath, 'utf8');

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const host = req.headers.host || '127.0.0.1';
    let url;
    try {
      url = new URL(req.url || '/', `http://${host}`);
    } catch {
      sendJSON(res, 400, { error: 'Bad request' });
      return;
    }
    const p = url.pathname;

    try {
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        sendHTML(res, 200, explorerHtml);
        return;
      }

      if (req.method === 'GET' && p === '/vendor/marked.js') {
        const data = await fs.readFile(markedPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', ...corsHeaders() });
        res.end(data);
        return;
      }

      if (req.method === 'GET' && p === '/vendor/dompurify.js') {
        const data = await fs.readFile(purifyPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', ...corsHeaders() });
        res.end(data);
        return;
      }

      if (req.method === 'GET' && p === '/api/sessions') {
        const sessions = await listSessions(projectDir);
        sendJSON(res, 200, sessions);
        return;
      }

      let m = /^\/api\/sessions\/([^/]+)\/summary$/.exec(p);
      if (m && req.method === 'GET') {
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
      sendJSON(res, 500, { error: String(/** @type {Error} */ (e).message || e) });
    }
  });

  return server;
}
