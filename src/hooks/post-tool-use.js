#!/usr/bin/env node
/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  createSession,
  loadSession,
  addAction,
  updateTaskTree,
} from '../core/state.js';
import { saveSnapshot, shortHash } from '../core/snapshot.js';
import { loadConfig } from '../core/config.js';
import { redactWithPatterns } from '../core/redact.js';
import { truncateBashOutput, truncateResponse } from '../core/truncate.js';
import { readStdinJson, getProjectDir, logErr } from './_lib.js';

/**
 * @param {Record<string, unknown>} input
 */
function extractRelatedFiles(toolName, input) {
  const files = new Set();
  const add = (p) => {
    if (typeof p === 'string' && p) files.add(p);
  };
  add(/** @type {any} */ (input).file_path);
  add(/** @type {any} */ (input).path);
  add(/** @type {any} */ (input).target_file);
  add(/** @type {any} */ (input).file);
  const paths = /** @type {any} */ (input).file_paths;
  if (Array.isArray(paths)) paths.forEach(add);
  return [...files];
}

/**
 * @param {string} projectDir
 * @param {string} filePath
 */
function toProjectRelative(projectDir, filePath) {
  if (!filePath) return null;
  const abs = path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
  const rel = path.relative(projectDir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * @param {PicklejarSession} session
 * @param {string} relPath
 * @param {string} content
 * @param {number} now
 * @param {'read' | 'write' | 'edit'} lastAction
 */
function upsertActiveFile(session, relPath, content, now, lastAction) {
  const idx = session.activeFiles.findIndex((f) => f.path === relPath);
  const hash = shortHash(content);
  const snap = {
    path: relPath,
    hash,
    content,
    lastTouchedAt: now,
    lastAction,
  };
  if (idx >= 0) session.activeFiles[idx] = snap;
  else session.activeFiles.push(snap);
}

/**
 * @param {PicklejarSession} session
 * @param {string} toolName
 * @param {Record<string, unknown>} input
 * @param {string} output
 */
function applyActiveFiles(session, toolName, input, output) {
  const tn = String(toolName);
  const rel = toProjectRelative(
    session.projectDir,
    /** @type {string | undefined} */ (
      /** @type {any} */ (input).file_path ??
        /** @type {any} */ (input).path ??
        /** @type {any} */ (input).target_file ??
        /** @type {any} */ (input).file
    ),
  );
  const now = Date.now();
  if (/read/i.test(tn) && rel) {
    upsertActiveFile(session, rel, output, now, 'read');
  }
  if ((/write/i.test(tn) || /edit/i.test(tn) || /multiedit/i.test(tn)) && rel) {
    const content = String(
      /** @type {any} */ (input).new_string ??
        /** @type {any} */ (input).content ??
        /** @type {any} */ (input).after ??
        output,
    ).slice(0, 500_000);
    const lastAction = /edit|multiedit/i.test(tn) ? 'edit' : 'write';
    upsertActiveFile(session, rel, content, now, lastAction);
  }
}

async function main() {
  const projectDir = getProjectDir();
  const payload = await readStdinJson();
  const sessionId = String(
    /** @type {any} */ (payload).session_id ?? /** @type {any} */ (payload).sessionId ?? 'unknown',
  );
  const toolName = String(
    /** @type {any} */ (payload).tool_name ?? /** @type {any} */ (payload).toolName ?? 'unknown',
  );
  const toolInput =
    (/** @type {any} */ (payload).tool_input ?? /** @type {any} */ (payload).toolInput ?? {}) ||
    {};
  let toolResponse = String(
    /** @type {any} */ (payload).tool_response ?? /** @type {any} */ (payload).toolResponse ?? '',
  );

  const cfg = await loadConfig(projectDir);
  toolResponse = redactWithPatterns(toolResponse, cfg.redactPatterns);
  if (/bash/i.test(toolName)) {
    toolResponse = truncateBashOutput(toolResponse);
  } else {
    toolResponse = truncateResponse(toolResponse);
  }

  let session = await loadSession(projectDir, sessionId);
  if (!session) session = createSession(sessionId, projectDir);

  const tp = /** @type {any} */ (payload).transcript_path ?? /** @type {any} */ (payload).transcriptPath;
  if (typeof tp === 'string') session.transcriptPath = tp;

  const action = {
    id: randomUUID(),
    timestamp: Date.now(),
    toolName,
    input: typeof toolInput === 'object' && toolInput ? { ...toolInput } : {},
    output: toolResponse,
    relatedFiles: extractRelatedFiles(toolName, toolInput),
  };

  addAction(session, action);
  updateTaskTree(session, action);
  applyActiveFiles(session, toolName, action.input, toolResponse);

  await saveSnapshot(session);
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
