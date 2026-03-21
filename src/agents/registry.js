import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resumeContextPath } from '../core/paths.js';
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
  return true;
}

/**
 * @param {string} agent
 * @param {string} projectDir
 */
export function spawnAgent(agent, projectDir) {
  const onExit = (child) => {
    child.on('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 0);
    });
  };

  switch (agent) {
    case 'claude': {
      const child = spawn('claude', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'cursor': {
      const child = spawn('cursor', [projectDir], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'continue': {
      const child = spawn('cn', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'copilot': {
      const child = spawn('copilot', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'cline': {
      console.log(
        'Cline runs inside VS Code — open this folder in VS Code with the Cline extension. Hooks in .clinerules/hooks are active.',
      );
      process.exit(0);
      break;
    }
    case 'opencode': {
      const child = spawn('opencode', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'kilo': {
      const child = spawn('kilo', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    case 'antigravity': {
      console.log(
        'Google Antigravity is an IDE — open this project there. After `picklejar resume`, context is in .agent/picklejar-resume.md (and AGENTS.md if you also use opencode/kilo workflow).',
      );
      process.exit(0);
      break;
    }
    case 'aider': {
      const child = spawn('aider', [], { stdio: 'inherit', cwd: projectDir });
      onExit(child);
      break;
    }
    default:
      console.error(`Unknown agent '${agent}'`);
      process.exitCode = 1;
  }
}
