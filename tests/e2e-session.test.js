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
  it('init creates run-hook and settings', async () => {
    const { code, err } = await runCli(['init', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const rh = path.join(proj, '.picklejar', 'hooks', 'run-hook.js');
    await fs.access(rh);
    const settings = JSON.parse(await fs.readFile(path.join(proj, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PostToolUse).toBeDefined();
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
