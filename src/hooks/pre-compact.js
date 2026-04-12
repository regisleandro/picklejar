#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSession, createSession } from '../core/state.js';
import { saveSnapshot } from '../core/snapshot.js';
import { transcriptsDir } from '../core/paths.js';
import { readStdinJson, getProjectDir, logErr } from './_lib.js';
import { resolveSessionIdFromPayload } from '../core/normalize-payload.js';

const MAX_TRANSCRIPT_BACKUPS = 5;

async function backupTranscript(projectDir, sessionId, transcriptPath) {
  if (!transcriptPath) return;
  try {
    const dir = transcriptsDir(projectDir);
    await fs.mkdir(dir, { recursive: true });
    const base = path.basename(transcriptPath);
    const dest = path.join(dir, `${sessionId}-${Date.now()}-${base || 'transcript.jsonl'}`);
    await fs.copyFile(transcriptPath, dest);
    await pruneTranscriptBackups(dir, sessionId);
  } catch (e) {
    logErr(e);
  }
}

/**
 * Keep only the newest MAX_TRANSCRIPT_BACKUPS files for the given session.
 * @param {string} dir
 * @param {string} sessionId
 */
async function pruneTranscriptBackups(dir, sessionId) {
  try {
    const entries = await fs.readdir(dir);
    const prefix = `${sessionId}-`;
    const sessionFiles = entries
      .filter((f) => f.startsWith(prefix))
      .sort();
    const toDrop = sessionFiles.slice(0, Math.max(0, sessionFiles.length - MAX_TRANSCRIPT_BACKUPS));
    for (const f of toDrop) {
      await fs.unlink(path.join(dir, f)).catch(() => {});
    }
  } catch {
    /* ignore readdir errors */
  }
}

async function main() {
  const projectDir = getProjectDir();
  const payload = await readStdinJson();
  const sessionId = resolveSessionIdFromPayload(payload);
  const transcriptPath =
    /** @type {any} */ (payload).transcript_path ?? /** @type {any} */ (payload).transcriptPath;

  let session = sessionId ? await loadSession(projectDir, sessionId) : null;
  if (!session && sessionId) {
    session = createSession(sessionId, projectDir);
  }
  if (!session) return;

  if (typeof transcriptPath === 'string') {
    session.transcriptPath = transcriptPath;
    await backupTranscript(projectDir, session.sessionId, transcriptPath);
  }

  await saveSnapshot(session, 'pre-compact');
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
