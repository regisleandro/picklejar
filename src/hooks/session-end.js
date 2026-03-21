#!/usr/bin/env node

import { loadSession } from '../core/state.js';
import { saveSnapshot } from '../core/snapshot.js';
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

  session.ended = true;
  await saveSnapshot(session, 'session-end');
}

main().catch((e) => {
  logErr(e);
  process.exitCode = 1;
});
