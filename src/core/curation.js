export const CURATION_STATUSES = Object.freeze([
  'default',
  'confirmed',
  'discarded',
  'hallucinated',
  'inconsistent',
  'dead_end',
]);

export const CURATION_PROFILES = Object.freeze([
  'balanced',
  'strict',
  'audit',
  'recovery',
]);

export const EXCLUDED_CURATION_STATUSES = new Set([
  'discarded',
  'hallucinated',
  'inconsistent',
  'dead_end',
]);

/**
 * @param {string | undefined} status
 */
export function normalizeCurationStatus(status) {
  const value = String(status ?? 'default').trim().toLowerCase();
  return CURATION_STATUSES.includes(value) ? value : null;
}

/**
 * @param {string | undefined} profile
 */
export function normalizeCurationProfile(profile) {
  const value = String(profile ?? 'balanced').trim().toLowerCase();
  return CURATION_PROFILES.includes(value) ? value : null;
}

/**
 * @param {import('../types/index.d.ts').ToolAction} action
 */
export function actionIsExcludedByCuration(action) {
  if (action.includeInBrainDump === false) return true;
  return EXCLUDED_CURATION_STATUSES.has(action.curationStatus ?? 'default');
}

/**
 * @param {import('../types/index.d.ts').ToolAction} action
 * @param {'balanced' | 'strict' | 'audit' | 'recovery'} profile
 * @param {boolean} ignoreCuration
 */
export function actionIncludedInProfile(action, profile = 'balanced', ignoreCuration = false) {
  if (ignoreCuration) return true;
  const status = action.curationStatus ?? 'default';
  if (action.includeInBrainDump === false) {
    return profile === 'audit';
  }
  switch (profile) {
    case 'strict':
      return status === 'confirmed';
    case 'audit':
      return true;
    case 'recovery':
      return status !== 'hallucinated' && status !== 'inconsistent';
    case 'balanced':
    default:
      return !EXCLUDED_CURATION_STATUSES.has(status);
  }
}

/**
 * @param {import('../types/index.d.ts').ToolAction} action
 */
export function formatActionCurationStatus(action) {
  return action.curationStatus ?? 'default';
}

/**
 * @param {import('../types/index.d.ts').ToolAction} action
 */
export function actionPriority(action) {
  if (action.curationStatus === 'confirmed') return 3;
  if (actionIsExcludedByCuration(action)) return 0;
  return 2;
}

/**
 * @param {import('../types/index.d.ts').PicklejarSession} session
 * @param {number[]} indexes
 * @param {(action: import('../types/index.d.ts').ToolAction) => void} updater
 */
export function mutateActionsByIndexes(session, indexes, updater) {
  const selected = [...new Set(indexes
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0))];
  let changed = 0;
  for (const idx of selected) {
    const action = session.actions?.[idx - 1];
    if (!action) continue;
    updater(action);
    changed += 1;
  }
  if (changed > 0) session.lastUpdatedAt = Date.now();
  return changed;
}

/**
 * @param {import('../types/index.d.ts').PicklejarSession} session
 */
export function suggestCurationForSession(session) {
  const suggestions = [];
  for (let idx = 0; idx < (session.actions ?? []).length; idx += 1) {
    const action = session.actions[idx];
    if (action.curationStatus && action.curationStatus !== 'default') continue;

    const output = String(action.output ?? '').trim();
    if (!output) {
      suggestions.push({
        index: idx + 1,
        id: action.id,
        suggestedStatus: 'dead_end',
        reason: 'empty output',
      });
      continue;
    }

    if (/\b(not found|no such file|failed|failure|unable|invalid|exception|traceback|error)\b/i.test(output)) {
      suggestions.push({
        index: idx + 1,
        id: action.id,
        suggestedStatus: 'inconsistent',
        reason: 'failure keywords detected in tool output',
      });
      continue;
    }

    if (/\b(reverted|rolled back|undo|undid)\b/i.test(output)) {
      suggestions.push({
        index: idx + 1,
        id: action.id,
        suggestedStatus: 'dead_end',
        reason: 'output suggests the attempt was reverted',
      });
    }
  }
  return suggestions;
}

/**
 * @param {import('../types/index.d.ts').PicklejarSession} session
 */
export function summarizeCurationStats(session) {
  const stats = {
    total: session.actions?.length ?? 0,
    included: 0,
    excluded: 0,
    suggested: 0,
    byStatus: Object.fromEntries(CURATION_STATUSES.map((status) => [status, 0])),
  };
  const suggestedIds = new Set(suggestCurationForSession(session).map((row) => row.id));
  for (const action of session.actions ?? []) {
    const status = action.curationStatus ?? 'default';
    stats.byStatus[status] += 1;
    if (actionIsExcludedByCuration(action)) stats.excluded += 1;
    else stats.included += 1;
    if (suggestedIds.has(action.id)) stats.suggested += 1;
  }
  return stats;
}
