import fs from 'node:fs/promises';
import path from 'node:path';
import {
  picklejarRoot,
  hooksTargetDir,
  snapshotsDir,
  transcriptsDir,
} from '../core/paths.js';
import { runHookScript, claudeHooksBlock } from '../core/init-templates.js';
import { defaultConfig } from '../core/config.js';
import { mergeClaudeStyleHooks, mergeCursorHooksJson } from '../core/settings-merge.js';
import {
  cursorPicklejarHooksDoc,
  continueHooksBlock,
  copilotPicklejarHooksJson,
  copilotHookShellScriptFor,
  copilotHookPowerShellScriptFor,
  clineHookFiles,
} from '../core/agent-templates.js';

/**
 * @param {string} projectRoot
 */
export async function ensureGitignoreEntries(projectRoot) {
  const gi = path.join(projectRoot, '.gitignore');
  const lines = [
    '',
    '# picklejar',
    '.picklejar/snapshots/',
    '.picklejar/transcripts/',
    '.picklejar/.picklejar.lock',
    '.picklejar/force-resume.json',
    '.github/hooks/logs/',
  ];
  let content = '';
  try {
    content = await fs.readFile(gi, 'utf8');
  } catch {
    content = '';
  }
  let next = content;
  for (const line of lines) {
    if (line && !next.includes(line.trim())) {
      next += (next.endsWith('\n') || next.length === 0 ? '' : '\n') + line + '\n';
    }
  }
  if (next !== content) await fs.writeFile(gi, next, 'utf8');
}

/**
 * Core .picklejar layout (all agents).
 * @param {string} projectDir
 * @param {string} pkgRoot
 */
export async function ensurePicklejarCore(projectDir, pkgRoot) {
  await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
  await fs.mkdir(hooksTargetDir(projectDir), { recursive: true });
  await fs.mkdir(snapshotsDir(projectDir), { recursive: true });
  await fs.mkdir(transcriptsDir(projectDir), { recursive: true });

  const cfgPath = path.join(picklejarRoot(projectDir), 'config.json');
  try {
    await fs.access(cfgPath);
  } catch {
    await fs.writeFile(cfgPath, JSON.stringify(defaultConfig(), null, 2), 'utf8');
  }

  const runHookPath = path.join(hooksTargetDir(projectDir), 'run-hook.js');
  await fs.writeFile(runHookPath, runHookScript(pkgRoot), 'utf8');
  await fs.chmod(runHookPath, 0o755);
}

/**
 * @param {string} projectDir
 * @returns {Promise<boolean | 'matchers-added'>}
 */
export async function initClaude(projectDir) {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  return mergeClaudeStyleHooks(settingsPath, claudeHooksBlock());
}

/**
 * @param {string} projectDir
 * @returns {Promise<boolean>}
 */
export async function initCursor(projectDir) {
  return mergeCursorHooksJson(projectDir, cursorPicklejarHooksDoc());
}

/**
 * @param {string} projectDir
 * @returns {Promise<boolean | 'matchers-added'>}
 */
export async function initContinue(projectDir) {
  const settingsPath = path.join(projectDir, '.continue', 'settings.json');
  return mergeClaudeStyleHooks(settingsPath, continueHooksBlock());
}

/**
 * @param {string} projectDir
 */
export async function initCopilot(projectDir) {
  const hooksDir = path.join(projectDir, '.github', 'hooks');
  const scriptsDir = path.join(hooksDir, 'scripts');
  await fs.mkdir(scriptsDir, { recursive: true });

  const jsonPath = path.join(hooksDir, 'picklejar-agent.json');
  let skipJson = false;
  try {
    const raw = await fs.readFile(jsonPath, 'utf8');
    if (raw.includes('picklejar') && raw.includes('run-hook.js')) skipJson = true;
  } catch {
    /* write */
  }
  if (!skipJson) {
    await fs.writeFile(jsonPath, JSON.stringify(copilotPicklejarHooksJson(), null, 2), 'utf8');
  }

  const sh = [
    { name: 'picklejar-session-start.sh', hook: 'session-start' },
    { name: 'picklejar-post-tool-use.sh', hook: 'post-tool-use' },
    { name: 'picklejar-pre-compact.sh', hook: 'pre-compact' },
  ];
  for (const { name, hook } of sh) {
    const p = path.join(scriptsDir, name);
    await fs.writeFile(p, copilotHookShellScriptFor(hook), 'utf8');
    await fs.chmod(p, 0o755);
  }

  const ps1 = [
    { name: 'picklejar-session-start.ps1', hook: 'session-start' },
    { name: 'picklejar-post-tool-use.ps1', hook: 'post-tool-use' },
    { name: 'picklejar-pre-compact.ps1', hook: 'pre-compact' },
  ];
  for (const { name, hook } of ps1) {
    const p = path.join(scriptsDir, name);
    await fs.writeFile(p, copilotHookPowerShellScriptFor(hook), 'utf8');
  }
}

/**
 * @param {string} projectDir
 */
export async function initCline(projectDir) {
  for (const { relativePath, content, mode } of clineHookFiles()) {
    const full = path.join(projectDir, relativePath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
    if (mode) await fs.chmod(full, mode);
  }
}
