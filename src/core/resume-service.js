/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

import fs from 'node:fs/promises';
import { loadSnapshot } from './snapshot.js';
import { compileBrainDump, normalizeBrainDumpOptions } from './compiler.js';
import { loadConfig } from './config.js';
import { picklejarRoot, forceResumePath, resumeContextPath } from './paths.js';
import { normalizeCurationProfile } from './curation.js';
import { injectResumeContext, spawnAgent } from '../agents/registry.js';

/**
 * Map explorer/API exclude labels to brain dump section toggles (false = omit).
 * @param {string[]} exclude
 */
export function sectionsFromExcludeLabels(exclude) {
  /** @type {Record<string, string>} */
  const map = {
    history: 'summarizedHistory',
    instructions: 'resumeInstructions',
    'discarded paths': 'discardedPaths',
    discardedpaths: 'discardedPaths',
    goal: 'goal',
    'next action': 'nextPlannedAction',
    nextaction: 'nextPlannedAction',
    error: 'lastError',
    progress: 'progress',
    decisions: 'decisions',
    'active files': 'activeFiles',
    activefiles: 'activeFiles',
    'recent actions': 'recentActions',
    recentactions: 'recentActions',
  };

  /** @type {Record<string, boolean>} */
  const patch = {};
  for (const raw of exclude) {
    const key = String(raw).trim().toLowerCase();
    const section = map[key];
    if (section) patch[section] = false;
  }
  return patch;
}

/**
 * Brain dump options for handoff from profile + exclude section labels (API / explorer).
 * @param {{ profile?: string, exclude?: string[] }} options
 */
export function buildHandoffDumpOptions(options = {}) {
  const sectionPatch = sectionsFromExcludeLabels(options.exclude ?? []);
  return normalizeBrainDumpOptions({
    sections: sectionPatch,
    curationProfile: normalizeCurationProfile(options.profile) ?? 'balanced',
  });
}

/**
 * @typedef {ReturnType<typeof normalizeBrainDumpOptions>} NormalizedBrainDumpOptions
 */

/**
 * Writes resume-context.md and force-resume.json from the latest session snapshot.
 *
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.sessionId
 * @param {number} params.maxTokens
 * @param {NormalizedBrainDumpOptions} params.brainDumpOpts
 * @param {PicklejarSession} [params.session] when set, skips loadSnapshot
 * @returns {Promise<{ brainDump: string, sessionId: string }>}
 */
export async function prepareResumeContext({
  projectDir,
  sessionId,
  maxTokens,
  brainDumpOpts,
  session: sessionMaybe,
}) {
  const session =
    sessionMaybe ?? (await loadSnapshot(projectDir, sessionId))?.session ?? null;
  if (!session) {
    throw new Error('Session not found');
  }

  const md = compileBrainDump(session, { maxTokens, ...brainDumpOpts });

  await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
  await fs.writeFile(resumeContextPath(projectDir), md, 'utf8');
  await fs.writeFile(
    forceResumePath(projectDir),
    JSON.stringify({ sessionId, at: Date.now() }, null, 2),
    'utf8',
  );

  return { brainDump: md, sessionId };
}

/**
 * Prepare resume files, inject into agent adapters, then spawn the agent CLI.
 *
 * @param {object} params
 * @param {string} params.projectDir
 * @param {string} params.sessionId
 * @param {string} params.agent
 * @param {number} params.maxTokens
 * @param {NormalizedBrainDumpOptions} params.brainDumpOpts
 * @param {PicklejarSession} [params.session]
 * @param {(injected: boolean) => void} [params.onInjected] called after inject, before spawn
 * @param {boolean} [params.detachSpawn] spawn agent in background (explorer HTTP server)
 * @returns {Promise<{ success: true, agent: string, injected: boolean }>}
 */
export async function openSessionInAgent({
  projectDir,
  sessionId,
  agent,
  maxTokens,
  brainDumpOpts,
  session,
  onInjected,
  detachSpawn = false,
}) {
  await prepareResumeContext({
    projectDir,
    sessionId,
    maxTokens,
    brainDumpOpts,
    session,
  });
  const injected = await injectResumeContext(agent, projectDir);
  onInjected?.(injected);
  spawnAgent(agent, projectDir, { detach: detachSpawn });
  return { success: true, agent, injected };
}

/**
 * Loads config maxTokens and prepares resume context (convenience for HTTP handlers).
 *
 * @param {string} projectDir
 * @param {string} sessionId
 * @param {{ profile?: string, exclude?: string[] }} handoffOptions
 */
export async function prepareResumeContextForHandoff(projectDir, sessionId, handoffOptions = {}) {
  const cfg = await loadConfig(projectDir);
  const brainDumpOpts = buildHandoffDumpOptions(handoffOptions);
  return prepareResumeContext({
    projectDir,
    sessionId,
    maxTokens: cfg.maxTokens,
    brainDumpOpts,
  });
}
