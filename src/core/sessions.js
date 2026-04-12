/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

import { listSnapshots, loadSnapshot, listSnapshotFiles } from './snapshot.js';
import { deriveSessionTitle } from './list-summary.js';
import { summarizeCurationStats } from './curation.js';

/**
 * @param {PicklejarSession} session
 * @returns {'active' | 'ended' | 'error'}
 */
export function deriveSessionStatus(session) {
  if (session.ended === true) return 'ended';
  if (session.lastError) return 'error';
  return 'active';
}

/**
 * @param {string | undefined} value
 */
function compactText(value) {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @param {PicklejarSession} session
 * @param {number} [maxFiles]
 * @returns {string[]}
 */
export function collectSessionFiles(session, maxFiles = 10) {
  const ordered = [];
  const seen = new Set();

  for (const f of session.activeFiles ?? []) {
    const p = compactText(f.path);
    if (p && !seen.has(p)) {
      seen.add(p);
      ordered.push(p);
    }
  }

  const actions = session.actions ?? [];
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    for (const raw of actions[i].relatedFiles ?? []) {
      const p = compactText(raw);
      if (p && !seen.has(p)) {
        seen.add(p);
        ordered.push(p);
      }
    }
  }

  return ordered.slice(0, maxFiles);
}

/**
 * @param {PicklejarSession} session
 * @param {number} snapshotsCount
 */
export function buildSessionViewModel(session, snapshotsCount) {
  const goal = compactText(session.goal);
  /** @type {string | null} */
  const agentOrigin =
    session.agentOrigin != null && String(session.agentOrigin).trim()
      ? String(session.agentOrigin).trim()
      : null;

  return {
    sessionId: session.sessionId,
    title: deriveSessionTitle(session),
    goal: goal || null,
    agentOrigin,
    createdAt: session.createdAt,
    updatedAt: session.lastUpdatedAt,
    status: deriveSessionStatus(session),
    errorSummary: session.lastError ? String(session.lastError) : null,
    actionsCount: session.actions?.length ?? 0,
    snapshotsCount,
    activeFiles: collectSessionFiles(session, 20),
    decisions: (session.decisions ?? []).map((d) => d.description),
    lastPlannedAction: session.lastPlannedAction ? String(session.lastPlannedAction) : null,
    curationStats: summarizeCurationStats(session),
  };
}

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @returns {Promise<PicklejarSession | null>}
 */
export async function loadSessionDetail(projectDir, sessionId) {
  const loaded = await loadSnapshot(projectDir, sessionId);
  return loaded?.session ?? null;
}

/**
 * @param {string} projectDir
 * @param {string} sessionId
 * @returns {Promise<ReturnType<typeof buildSessionViewModel> | null>}
 */
export async function getSessionViewModel(projectDir, sessionId) {
  const session = await loadSessionDetail(projectDir, sessionId);
  if (!session) return null;
  const files = await listSnapshotFiles(projectDir, sessionId);
  return buildSessionViewModel(session, files.length);
}

/**
 * @param {string} projectDir
 * @returns {Promise<ReturnType<typeof buildSessionViewModel>[]>}
 */
export async function listSessions(projectDir) {
  const rows = await listSnapshots(projectDir);
  /** @type {Map<string, { count: number }>} */
  const bySession = new Map();
  for (const r of rows) {
    if (!bySession.has(r.sessionId)) {
      bySession.set(r.sessionId, { count: 0 });
    }
    bySession.get(r.sessionId).count += 1;
  }

  const out = (
    await Promise.all(
      Array.from(bySession.entries(), async ([sessionId, { count }]) => {
        const loaded = await loadSnapshot(projectDir, sessionId);
        if (!loaded) return null;
        return buildSessionViewModel(loaded.session, count);
      }),
    )
  ).filter(Boolean);

  out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}
