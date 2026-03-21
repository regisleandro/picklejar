#!/usr/bin/env node

import { loadSession } from '../core/state.js';
import { saveSnapshot } from '../core/snapshot.js';
import { extractLastPlannedAction } from '../core/transcript.js';
import { readStdinJson, getProjectDir, logErr } from './_lib.js';

async function main() {
  const projectDir = getProjectDir();
  const payload = await readStdinJson();
  const sessionId = String(
    /** @type {any} */ (payload).session_id ?? /** @type {any} */ (payload).sessionId ?? '',
  );
  if (!sessionId) return;

  const session = await loadSession(projectDir, sessionId);
  if (!session) return;

  const transcriptPath =
    /** @type {any} */ (payload).transcript_path ??
    /** @type {any} */ (payload).transcriptPath ??
    session.transcriptPath;
  if (typeof transcriptPath === 'string') {
    session.transcriptPath = transcriptPath;
  }

  const planned = await extractLastPlannedAction(
    typeof transcriptPath === 'string' ? transcriptPath : session.transcriptPath,
  );
  if (planned) session.lastPlannedAction = planned;

  await saveSnapshot(session, 'stop');
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
