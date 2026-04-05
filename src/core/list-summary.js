/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

const TITLE_MAX_LENGTH = 60;

/**
 * @param {string | undefined} value
 */
function compactText(value) {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} value
 * @param {number} maxLength
 */
function truncateText(value, maxLength) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

/**
 * @param {PicklejarSession} session
 */
export function deriveSessionTitle(session) {
  const candidates = [
    compactText(session.goal),
    compactText(session.lastPlannedAction),
    compactText(session.actions?.[session.actions.length - 1]?.relatedFiles?.[0]),
    compactText(session.actions?.[session.actions.length - 1]?.toolName),
  ].filter(Boolean);

  return truncateText(candidates[0] || 'Untitled session', TITLE_MAX_LENGTH);
}

/**
 * @param {PicklejarSession} session
 */
export function listPresentSections(session) {
  const sections = [];
  if (compactText(session.goal)) sections.push('goal');
  if (compactText(session.lastPlannedAction)) sections.push('next action');
  if (compactText(session.lastError)) sections.push('error');
  if ((session.taskTree ?? []).length > 0) sections.push('progress');
  if ((session.decisions ?? []).length > 0) sections.push('decisions');
  if ((session.activeFiles ?? []).length > 0) sections.push('active files');
  if ((session.actions ?? []).length > 0) {
    sections.push('recent actions');
    if (session.actions.length > 15) sections.push('history');
  }
  return sections;
}

/**
 * @param {PicklejarSession} session
 */
export function summarizeSessionForList(session) {
  return {
    title: deriveSessionTitle(session),
    actionsCount: session.actions?.length ?? 0,
    ended: Boolean(session.ended),
    sections: listPresentSections(session),
  };
}
