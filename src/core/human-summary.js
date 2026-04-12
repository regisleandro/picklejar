/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').ToolAction} ToolAction */

import { deriveSessionTitle } from './list-summary.js';
import { deriveSessionStatus, collectSessionFiles } from './sessions.js';
import { actionIsExcludedByCuration } from './curation.js';

/**
 * @param {number} timestampMs
 * @param {Date} [now]
 */
export function formatRelativeTime(timestampMs, now = new Date()) {
  const diff = now.getTime() - timestampMs;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${Math.max(0, sec)} sec ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? '' : 's'} ago`;

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestampMs));
}

/**
 * @param {number} timestampMs
 */
function formatAbsoluteTime(timestampMs) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestampMs));
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
 * @param {number} max
 */
function truncate(text, max) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 3)}...`;
}

/**
 * @param {ToolAction} action
 */
function actionBulletLine(action) {
  const file = action.relatedFiles?.[0];
  if (file) return truncate(file, 120);
  const tn = String(action.toolName ?? '').trim();
  const inp = truncate(stringifyInput(action.input), 80);
  if (tn && inp) return `${tn}: ${inp}`;
  return tn || inp || 'Action';
}

/**
 * Full title for the human summary heading — not truncated, unlike the CLI list title.
 * @param {PicklejarSession} session
 */
function deriveFullTitle(session) {
  const goal = session.goal?.replace(/\s+/g, ' ').trim();
  if (goal) return goal;
  const planned = session.lastPlannedAction?.replace(/\s+/g, ' ').trim();
  if (planned) return planned;
  return deriveSessionTitle(session);
}

/**
 * @param {PicklejarSession} session
 * @param {{ maxActions?: number }} [options]
 */
export function compileHumanSummary(session, options = {}) {
  const maxActions = options.maxActions ?? 5;
  const lines = [];

  lines.push(`## ${deriveFullTitle(session)}`);
  lines.push('');

  const status = deriveSessionStatus(session);
  const statusLabel = status === 'ended' ? 'completed' : status;
  lines.push(`**Status:** ${statusLabel}`);
  lines.push(`**Last updated:** ${formatAbsoluteTime(session.lastUpdatedAt)}`);
  lines.push('');

  const includedActions = (session.actions ?? []).filter((a) => !actionIsExcludedByCuration(a));
  if (includedActions.length > 0) {
    lines.push('### What was done');
    const slice = includedActions.slice(-maxActions);
    for (const a of slice) {
      lines.push(`- ${actionBulletLine(a)}`);
    }
    lines.push('');
  }

  const keyFiles = collectSessionFiles(session, 5);
  if (keyFiles.length > 0) {
    lines.push('### Key files');
    lines.push(keyFiles.map((p) => `\`${p}\``).join(', '));
    lines.push('');
  }

  const planned = session.lastPlannedAction?.replace(/\s+/g, ' ').trim();
  if (planned) {
    lines.push('### Next action');
    lines.push(planned);
    lines.push('');
  }

  const err = session.lastError?.replace(/\s+/g, ' ').trim();
  if (err) {
    lines.push('### Error');
    lines.push(err);
    lines.push('');
  }

  const decisions = (session.decisions ?? []).slice(0, 3);
  if (decisions.length > 0) {
    lines.push('### Decisions');
    for (const d of decisions) {
      lines.push(`- ${d.description}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
