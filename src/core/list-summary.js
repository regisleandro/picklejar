/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').ToolAction} ToolAction */

export const TITLE_MAX_LENGTH = 80;

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
 * @param {unknown} value
 */
function stringifyInput(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * @param {string} text
 */
function isHumanReadablePlannedAction(text) {
  const t = compactText(text);
  if (!t || t.length > 240) return false;
  if (/^\s*[\[{]/.test(t)) return false;
  return true;
}

/**
 * @param {ToolAction} action
 */
function titleFromRelevantAction(action) {
  const tn = String(action.toolName ?? '').toLowerCase();
  if (tn.includes('user') || tn === 'user_message') {
    const raw = stringifyInput(action.input);
    const line = compactText(raw);
    if (line) return truncateText(line, TITLE_MAX_LENGTH);
  }
  if (/\b(edit|write|apply_patch|search_replace|str_replace|multiedit)\b/.test(tn)) {
    const rf = action.relatedFiles?.[0];
    if (rf) return truncateText(compactText(rf), TITLE_MAX_LENGTH);
  }
  return '';
}

/**
 * @param {PicklejarSession} session
 */
function deriveTitleFromActions(session) {
  for (const action of session.actions ?? []) {
    const candidate = titleFromRelevantAction(action);
    if (candidate) return candidate;
  }
  return '';
}

/**
 * @param {PicklejarSession} session
 */
function sessionTitleFallback(session) {
  const id = session.sessionId ?? 'unknown';
  const short = id.length <= 8 ? id : id.slice(0, 8);
  return `Session ${short}`;
}

/**
 * @param {PicklejarSession} session
 */
export function deriveSessionTitle(session) {
  const goal = compactText(session.goal);
  if (goal) return truncateText(goal, TITLE_MAX_LENGTH);

  const planned = compactText(session.lastPlannedAction);
  if (planned && isHumanReadablePlannedAction(planned)) {
    return truncateText(planned, TITLE_MAX_LENGTH);
  }

  const fromAction = deriveTitleFromActions(session);
  if (fromAction) return fromAction;

  return sessionTitleFallback(session);
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
