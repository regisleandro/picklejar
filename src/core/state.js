/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */
/** @typedef {import('../types/index.d.ts').ToolAction} ToolAction */

import { randomUUID } from 'node:crypto';
import { loadLatestSessionSnapshot } from './snapshot.js';

const MAX_ACTIONS = 200;

/**
 * @param {string} sessionId
 * @param {string} projectDir
 * @returns {PicklejarSession}
 */
export function createSession(sessionId, projectDir) {
  const now = Date.now();
  return {
    sessionId,
    projectDir,
    createdAt: now,
    lastUpdatedAt: now,
    snapshotCount: 0,
    goal: '',
    taskTree: [],
    actions: [],
    activeFiles: [],
    decisions: [],
  };
}

/**
 * @param {string} projectDir
 * @param {string} [sessionId]
 * @returns {Promise<PicklejarSession | null>}
 */
export async function loadSession(projectDir, sessionId) {
  return loadLatestSessionSnapshot(projectDir, sessionId);
}

/**
 * @param {PicklejarSession} session
 * @param {ToolAction} action
 */
export function addAction(session, action) {
  session.actions.push(action);
  if (session.actions.length > MAX_ACTIONS) {
    session.actions = session.actions.slice(-MAX_ACTIONS);
  }
  session.lastUpdatedAt = Date.now();
}

/**
 * @param {PicklejarSession} session
 * @param {ToolAction} action
 */
export function updateTaskTree(session, action) {
  if (session.taskTree.length === 0) {
    session.taskTree.push({
      id: randomUUID(),
      description: 'Session work',
      status: 'in_progress',
      subtasks: [],
      actionsIds: [action.id],
    });
    session.lastUpdatedAt = Date.now();
    return;
  }
  const inProgress = session.taskTree.find((n) => n.status === 'in_progress');
  const target = inProgress ?? session.taskTree[0];
  if (!target.actionsIds.includes(action.id)) {
    target.actionsIds.push(action.id);
  }
  session.lastUpdatedAt = Date.now();
}

/**
 * @param {PicklejarSession} session
 * @param {string} error
 */
export function setError(session, error) {
  session.lastError = error;
  session.lastUpdatedAt = Date.now();
}
