import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from '../src/core/snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'src', 'cli.js');

function runCli(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function runHook(name, json, env) {
  const script = path.join(root, 'src', 'hooks', `${name}.js`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(json));
    child.stdin.end();
  });
}

let proj;

beforeEach(async () => {
  proj = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-e2e-'));
});

afterEach(async () => {
  await fs.rm(proj, { recursive: true, force: true });
});

describe('e2e', () => {
  it('init creates run-hook and settings with both resume and startup matchers', async () => {
    const { code, err } = await runCli(['init', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const rh = path.join(proj, '.picklejar', 'hooks', 'run-hook.js');
    await fs.access(rh);
    const settings = JSON.parse(await fs.readFile(path.join(proj, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PostToolUse).toBeDefined();
    const sessionStartMatchers = settings.hooks.SessionStart.map((e) => e.matcher);
    expect(sessionStartMatchers).toContain('resume');
    expect(sessionStartMatchers).toContain('startup');
  });

  it('init upgrades existing hooks adding startup matcher if missing', async () => {
    // Simulate old installation with only 'resume' matcher
    const settingsPath = path.join(proj, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const oldSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: 'resume',
            hooks: [{ type: 'command', command: `node ${proj}/.picklejar/hooks/run-hook.js session-start` }],
          },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(oldSettings, null, 2), 'utf8');
    const { code, out } = await runCli(['init', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('startup matcher added');
    const updated = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const matchers = updated.hooks.SessionStart.map((e) => e.matcher);
    expect(matchers).toContain('startup');
  });

  it('goal command sets session goal', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'goal-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'x.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(['goal', 'Ship JWT auth', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('Ship JWT auth');
    const snap = await loadSnapshot(proj, 'goal-cli');
    expect(snap?.session.goal).toBe('Ship JWT auth');
  });

  it('decide command appends to decisions', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'decide-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'y.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(
      ['decide', 'PostgreSQL', 'relational data', proj],
      process.cwd(),
    );
    expect(code).toBe(0);
    expect(out).toContain('PostgreSQL');
    const snap = await loadSnapshot(proj, 'decide-cli');
    expect(snap?.session.decisions).toHaveLength(1);
    expect(snap?.session.decisions[0].description).toBe('PostgreSQL');
    expect(snap?.session.decisions[0].reasoning).toBe('relational data');
  });

  it('resume flag + session-start loads brain dump', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'e2e1',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
        tool_response: 'hi\n'.repeat(600),
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code } = await runCli(['resume', '--id', 'e2e1', proj], process.cwd());
    expect(code).toBe(0);
    const { code: c2, stdout } = await runHook(
      'session-start',
      { source: 'startup', session_id: 'e2e1' },
      { CLAUDE_PROJECT_DIR: proj },
    );
    expect(c2).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toBeDefined();
    const snap = await loadSnapshot(proj, 'e2e1');
    expect(snap?.session.actions[0].output.split('\n').length).toBeLessThan(600);
  });
});
