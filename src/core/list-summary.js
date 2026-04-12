/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').ToolAction} ToolAction */

import path from 'node:path';

export const TITLE_MAX_LENGTH = 60;

/**
 * @param {string | undefined} value
 */
function compactText(value) {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * True when the line is only an XML-like open/close tag (agent transcript wrappers, etc.).
 * @param {string} line
 */
function isTagOnlyLine(line) {
  const t = line.trim();
  if (!t) return false;
  return /^<\/?[a-zA-Z_][\w-]*>$/.test(t);
}

/**
 * First non-empty line that is not a tag-only wrapper line.
 * @param {string} text
 */
function pickFirstSubstantiveLine(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  for (const line of lines) {
    if (line.length > 0 && !isTagOnlyLine(line)) return line;
  }
  return '';
}

/**
 * If the whole string is one `<name>...</name>` block, return inner text; else return trimmed input.
 * @param {string} line
 */
function unwrapSingleLineWrapper(line) {
  const trimmed = line.trim();
  const m = trimmed.match(/^<([a-zA-Z_][\w-]*)>([\s\S]*)<\/\1>$/);
  if (m) return m[2].trim();
  return trimmed;
}

/**
 * Strips common markdown noise and returns the first sentence (or first line if no sentence end).
 * Skips tag-only lines and unwraps a single-line `<tag>...</tag>` wrapper when present.
 * @param {string | undefined} text
 */
function extractFirstSentence(text) {
  if (text == null || text === '') return '';
  let s = String(text);
  s = s.replace(/`+/g, '');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/^#+\s+/gm, '');
  s = s.replace(/^\s*[-*]\s+/gm, '');
  const substantive = pickFirstSubstantiveLine(s);
  if (!substantive) return '';
  const unwrapped = unwrapSingleLineWrapper(substantive);
  if (!unwrapped) return '';
  const line = unwrapped.replace(/\s+/g, ' ').trim();
  const m = line.match(/^(.+?[.!?])(\s|$)/);
  if (m) return m[1].trim();
  return line;
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
 * @param {unknown} input
 */
function userMessageTitleLine(input) {
  if (typeof input === 'string') {
    const fromSentence = extractFirstSentence(input);
    if (fromSentence) return fromSentence;
    return compactText(input);
  }
  if (input && typeof input === 'object') {
    const o = /** @type {Record<string, unknown>} */ (input);
    for (const key of ['message', 'content', 'text', 'prompt', 'query', 'user_query', 'input', 'body']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return userMessageTitleLine(v);
    }
  }
  const raw = stringifyInput(input);
  const fromSentence = extractFirstSentence(raw);
  if (fromSentence) return fromSentence;
  return compactText(raw.slice(0, 500));
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
    const line = userMessageTitleLine(action.input);
    if (line) return truncateText(line, TITLE_MAX_LENGTH);
  }
  if (/\b(edit|write|apply_patch|search_replace|str_replace|multiedit)\b/.test(tn)) {
    const rf = action.relatedFiles?.[0];
    if (rf) {
      const base = path.basename(compactText(rf));
      if (base) return truncateText(base, TITLE_MAX_LENGTH);
    }
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
  const goalLine = extractFirstSentence(session.goal);
  if (goalLine) return truncateText(goalLine, TITLE_MAX_LENGTH);

  const plannedFull = compactText(session.lastPlannedAction);
  if (plannedFull && isHumanReadablePlannedAction(plannedFull)) {
    const plannedLine = extractFirstSentence(session.lastPlannedAction) || plannedFull;
    return truncateText(plannedLine, TITLE_MAX_LENGTH);
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
