#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadSession, createSession } from '../core/state.js';
import { saveSnapshot } from '../core/snapshot.js';
import { transcriptsDir } from '../core/paths.js';
import { readStdinJson, getProjectDir, logErr } from './_lib.js';
import { resolveSessionIdFromPayload } from '../core/normalize-payload.js';

async function backupTranscript(projectDir, sessionId, transcriptPath) {
  if (!transcriptPath) return;
  try {
    await fs.mkdir(transcriptsDir(projectDir), { recursive: true });
    const base = path.basename(transcriptPath);
    const dest = path.join(
      transcriptsDir(projectDir),
      `${sessionId}-${Date.now()}-${base || 'transcript.jsonl'}`,
    );
    await fs.copyFile(transcriptPath, dest);
  } catch (e) {
    logErr(e);
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
