import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resumeContextPath, forceResumePath } from '../core/paths.js';
import { writeResumeToClaude } from '../adapters/claude-code.js';
import { writeResumeToAgentsMd } from '../adapters/agents-md.js';
import { writeResumeToAntigravity } from '../adapters/antigravity.js';
import { writeResumeToConventions } from '../adapters/aider-conventions.js';
import {
  ensurePicklejarCore,
  ensureGitignoreEntries,
  initClaude,
  initCursor,
  initContinue,
  initCopilot,
  initCline,
} from './setup.js';

export const AGENT_IDS = [
  'claude',
  'cursor',
  'copilot',
  'cline',
  'continue',
  'opencode',
  'kilo',
  'antigravity',
  'aider',
];

/** @type {Record<string, { track: string; hooks: boolean; instructions: boolean; notes?: string }>} */
export const CAPABILITIES = {
  claude: { track: 'hooks', hooks: true, instructions: true, notes: 'CLAUDE.md + SessionStart' },
  cursor: { track: 'hooks', hooks: true, instructions: true, notes: '.cursor/hooks.json' },
  copilot: { track: 'hooks', hooks: true, instructions: true, notes: '.github/hooks/picklejar-agent.json' },
  cline: { track: 'hooks', hooks: true, instructions: true, notes: '.clinerules/hooks/*' },
  continue: { track: 'hooks', hooks: true, instructions: true, notes: '.continue/settings.json (Claude-compatible)' },
  opencode: { track: 'instructions', hooks: false, instructions: true, notes: 'AGENTS.md + opencode CLI' },
  kilo: { track: 'instructions', hooks: false, instructions: true, notes: 'AGENTS.md + kilo CLI (OpenCode-fork config)' },
  antigravity: { track: 'instructions', hooks: false, instructions: true, notes: '.agent/picklejar-resume.md MVP' },
  aider: { track: 'instructions', hooks: false, instructions: true, notes: 'CONVENTIONS.md optional' },
};

/**
 * @param {string} [a]
 * @param {string} [b]
 */
export function parseInitArgs(a, b) {
  const known = new Set(AGENT_IDS);
  if (!a && !b) return { agent: 'claude', dir: process.cwd() };
  if (a && !b) {
    if (known.has(a)) return { agent: a, dir: process.cwd() };
    return { agent: 'claude', dir: path.resolve(a) };
  }
  if (a && b) {
    if (known.has(a)) {
      return { agent: a, dir: path.resolve(b) };
    }
    // Legacy: `picklejar init <dir>` with default second arg — first token is a path
    return { agent: 'claude', dir: path.resolve(a) };
  }
  return { agent: 'claude', dir: process.cwd() };
}

/**
 * @param {string} agent
 * @param {string} projectDir
 * @param {string} pkgRoot
 * @returns {Promise<string>}
 */
export async function runAgentInit(agent, projectDir, pkgRoot) {
  await ensurePicklejarCore(projectDir, pkgRoot);
  await ensureGitignoreEntries(projectDir);

  let detail = '';
  switch (agent) {
    case 'claude': {
      const r = await initClaude(projectDir);
      detail =
        r === 'matchers-added'
          ? 'Claude settings.json updated (missing SessionStart matchers added).'
          : r
            ? 'Claude settings.json updated (hooks appended).'
            : 'Claude hooks already present; settings unchanged.';
      break;
    }
    case 'cursor': {
      const r = await initCursor(projectDir);
      detail = r ? '.cursor/hooks.json updated.' : 'Cursor hooks already present; hooks.json unchanged.';
      break;
    }
    case 'continue': {
      const r = await initContinue(projectDir);
      detail =
        r === 'matchers-added'
          ? '.continue/settings.json updated (matchers added).'
          : r
            ? '.continue/settings.json updated.'
            : 'Continue hooks already present.';
      break;
    }
    case 'copilot': {
      await initCopilot(projectDir);
      detail = '.github/hooks/picklejar-agent.json and scripts installed.';
      break;
    }
    case 'cline': {
      await initCline(projectDir);
      detail = '.clinerules/hooks/* installed.';
      break;
    }
    case 'opencode':
    case 'kilo':
    case 'antigravity':
    case 'aider':
      detail =
        'Instructions-track agent: use `picklejar resume` then `picklejar start <agent>`. See docs/CAPABILITY_MATRIX.md.';
      break;
    default:
      throw new Error(`No init provider for ${agent}`);
  }

  return detail;
}

/**
 * @param {string} agent
 * @param {string} projectDir
 */
export async function injectResumeContext(agent, projectDir) {
  const ctxPath = resumeContextPath(projectDir);
  let brain = '';
  try {
    brain = await fs.readFile(ctxPath, 'utf8');
  } catch {
    return false;
  }
  if (!brain.trim()) return false;

  switch (agent) {
    case 'claude':
      await writeResumeToClaude(projectDir, brain);
      break;
    case 'cursor':
    case 'continue':
    case 'cline':
      await writeResumeToClaude(projectDir, brain);
      await writeResumeToAgentsMd(projectDir, brain);
      break;
    case 'copilot':
      await writeResumeToAgentsMd(projectDir, brain);
      break;
    case 'opencode':
    case 'kilo':
      await writeResumeToAgentsMd(projectDir, brain);
      break;
    case 'antigravity':
      await fs.mkdir(path.join(projectDir, '.agent'), { recursive: true });
      await writeResumeToAntigravity(projectDir, brain);
      break;
    case 'aider':
      await writeResumeToConventions(projectDir, brain);
      break;
    default:
      await writeResumeToAgentsMd(projectDir, brain);
  }

  // Clean up resume artifacts so stale context is not re-injected on the next
  // `picklejar start` call. For hooks-track agents the session-start hook also
  // tries to delete force-resume.json, so this is intentionally idempotent.
  await fs.unlink(ctxPath).catch(() => {});
  await fs.unlink(forceResumePath(projectDir)).catch(() => {});

  return true;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptionsWithoutStdio & { stdio: 'ignore' | 'inherit' }} childSpawnOpts
 * @param {boolean} detach
 * @param {(child: import('node:child_process').ChildProcessWithoutNullStreams | import('node:child_process').ChildProcessByStdio<null, null, null>) => void} [onSpawn]
 */
function spawnChecked(command, args, childSpawnOpts, detach, onSpawn) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, childSpawnOpts);
    let settled = false;

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(
        new Error(`Failed to launch '${command}'. Ensure the CLI is installed and available in PATH. (${err.message})`),
      );
    });

    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      if (detach) child.unref();
      onSpawn?.(child);
      resolve();
    });
  });
}

/**
 * @param {string} agent
 * @param {string} projectDir
 * @param {{ detach?: boolean }} [spawnOpts] when detach, child is spawned in the background without replacing this process (explorer server)
 */
export async function spawnAgent(agent, projectDir, spawnOpts = {}) {
  const detach = Boolean(spawnOpts.detach);

  const onExit = (child) => {
    if (detach) return;
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 0);
    });
  };

  const childSpawnOpts = detach
    ? { stdio: 'ignore', detached: true, cwd: projectDir }
    : { stdio: 'inherit', cwd: projectDir };

  switch (agent) {
    case 'claude': {
      await spawnChecked('claude', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'cursor': {
      await spawnChecked('cursor', [projectDir], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'continue': {
      await spawnChecked('cn', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'copilot': {
      await spawnChecked('copilot', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'cline': {
      if (detach) {
        throw new Error('Cline runs inside VS Code and cannot be launched automatically from Open in agent.');
      }
      console.log(
        'Cline runs inside VS Code — open this folder in VS Code with the Cline extension. Hooks in .clinerules/hooks are active.',
      );
      process.exit(0);
      break;
    }
    case 'opencode': {
      await spawnChecked('opencode', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'kilo': {
      await spawnChecked('kilo', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    case 'antigravity': {
      if (detach) {
        throw new Error('Antigravity is IDE-based and cannot be launched automatically from Open in agent.');
      }
      console.log(
        'Google Antigravity is an IDE — open this project there. After `picklejar resume`, context is in .agent/picklejar-resume.md (and AGENTS.md if you also use opencode/kilo workflow).',
      );
      process.exit(0);
      break;
    }
    case 'aider': {
      await spawnChecked('aider', [], childSpawnOpts, detach, (child) => {
        if (!detach) onExit(child);
      });
      break;
    }
    default:
      throw new Error(`Unknown agent '${agent}'`);
  }
}
