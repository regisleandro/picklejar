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
import { extractGoalFromTranscript } from '../core/transcript.js';
import { detectAgentOrigin } from '../core/agent-origin.js';
import { readStdinJson, getProjectDir, getTranscriptPathFromEnv, logErr } from './_lib.js';
import { normalizePostToolUsePayload } from '../core/normalize-payload.js';

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
 * @param {string[]} redactPatterns
 */
function applyActiveFiles(session, toolName, input, output, redactPatterns) {
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
  if ((/read/i.test(tn) || /read_file|list_files|search_files/i.test(tn)) && rel) {
    upsertActiveFile(session, rel, redactWithPatterns(output, redactPatterns), now, 'read');
  }
  if (
    (/write/i.test(tn) ||
      /edit/i.test(tn) ||
      /multiedit/i.test(tn) ||
      /write_to_file|apply_diff|delete_file/i.test(tn)) &&
    rel
  ) {
    const raw = String(
      /** @type {any} */ (input).new_string ??
        /** @type {any} */ (input).content ??
        /** @type {any} */ (input).after ??
        output,
    ).slice(0, 500_000);
    const content = redactWithPatterns(raw, redactPatterns);
    const lastAction = /edit|multiedit|apply_diff/i.test(tn) ? 'edit' : 'write';
    upsertActiveFile(session, rel, content, now, lastAction);
  }
}

async function main() {
  const projectDir = getProjectDir();
  const rawPayload = await readStdinJson();
  const payload = normalizePostToolUsePayload(rawPayload);
  const agentOrigin = detectAgentOrigin(rawPayload);
  const sessionId = payload.sessionId;
  const toolName = payload.toolName;
  const toolInput = payload.toolInput;
  let toolResponse = payload.toolResponse;

  const cfg = await loadConfig(projectDir);
  toolResponse = redactWithPatterns(toolResponse, cfg.redactPatterns);
  if (/bash|execute_command|shell/i.test(toolName)) {
    toolResponse = truncateBashOutput(toolResponse);
  } else {
    toolResponse = truncateResponse(toolResponse);
  }

  let session = await loadSession(projectDir, sessionId);
  if (!session) session = createSession(sessionId, projectDir);
  if (agentOrigin) {
    session.agentOrigin = agentOrigin;
  }

  const tp =
    payload.transcriptPath ??
    /** @type {any} */ (rawPayload).transcript_path ??
    /** @type {any} */ (rawPayload).transcriptPath ??
    getTranscriptPathFromEnv();
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
  applyActiveFiles(session, toolName, action.input, toolResponse, cfg.redactPatterns);

  if (!session.goal) {
    const tp = session.transcriptPath;
    if (typeof tp === 'string' && tp) {
      const goal = await extractGoalFromTranscript(tp);
      if (goal) session.goal = goal;
    }
  }

  await saveSnapshot(session);
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
