export const CURATION_STATUSES = Object.freeze([
  'default',
  'confirmed',
  'discarded',
  'hallucinated',
  'inconsistent',
  'dead_end',
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
 * @param {import('../types/index.d.ts').ToolAction} action
 */
export function actionIsExcludedByCuration(action) {
  if (action.includeInBrainDump === false) return true;
  return EXCLUDED_CURATION_STATUSES.has(action.curationStatus ?? 'default');
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
