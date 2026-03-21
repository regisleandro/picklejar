#!/usr/bin/env node

import fs from 'node:fs/promises';
import { loadSession, createSession } from '../core/state.js';
import { saveSnapshot } from '../core/snapshot.js';
import { compileBrainDump } from '../core/compiler.js';
import { loadConfig } from '../core/config.js';
import { forceResumePath } from '../core/paths.js';
import { cleanResumeFromClaude } from '../adapters/claude-code.js';
import { extractGoalFromTranscript } from '../core/transcript.js';
import { readStdinJson, getProjectDir, logErr } from './_lib.js';

/**
 * @returns {Promise<{ sessionId?: string } | null>}
 */
async function readForceResume(projectDir) {
  try {
    const raw = await fs.readFile(forceResumePath(projectDir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const projectDir = getProjectDir();
  const payload = await readStdinJson();
  const source = String(
    /** @type {any} */ (payload).source ?? /** @type {any} */ (payload).Source ?? 'startup',
  ).toLowerCase();
  const sessionIdFromPayload = String(
    /** @type {any} */ (payload).session_id ?? /** @type {any} */ (payload).sessionId ?? '',
  );
  const cfg = await loadConfig(projectDir);
  const force = await readForceResume(projectDir);

  const shouldInject =
    source === 'resume' || source === 'compact' || (force != null && Object.keys(force).length > 0);

  if (source === 'startup' && sessionIdFromPayload) {
    let session = await loadSession(projectDir, sessionIdFromPayload);
    if (!session) {
      session = createSession(sessionIdFromPayload, projectDir);
      const tp = /** @type {any} */ (payload).transcript_path ?? /** @type {any} */ (payload).transcriptPath;
      if (typeof tp === 'string') session.transcriptPath = tp;
    }
    if (!session.goal && session.transcriptPath) {
      const goal = await extractGoalFromTranscript(session.transcriptPath);
      if (goal) session.goal = goal;
    }
    await saveSnapshot(session, 'startup');
  }

  if (!shouldInject) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const targetId =
    (force?.sessionId != null ? String(force.sessionId) : '') || sessionIdFromPayload || '';
  /** @type {import('../types/index.d.ts').PicklejarSession | null} */
  let session = targetId ? await loadSession(projectDir, targetId) : null;
  if (!session) {
    session = await loadSession(projectDir);
  }
  if (!session) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // For startup source: additionalContext doesn't work in Claude Code.
  // Context was injected via CLAUDE.md by `picklejar start` — just clean up.
  // For resume/compact sources: additionalContext works, use it.
  if (source === 'startup') {
    process.stdout.write(JSON.stringify({}));
  } else {
    const md = compileBrainDump(session, { maxTokens: cfg.maxTokens });
    process.stdout.write(JSON.stringify({ additionalContext: md }));
  }

  if (force) {
    try {
      await fs.unlink(forceResumePath(projectDir));
    } catch { /* ignore */ }
    await cleanResumeFromClaude(projectDir);
  }
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
