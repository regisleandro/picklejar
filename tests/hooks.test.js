import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from '../src/core/snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {string} hookBase - e.g. post-tool-use (no .js)
 * @param {Record<string, unknown>} stdinJson
 * @param {NodeJS.ProcessEnv} [env]
 */
function runHook(hookBase, stdinJson, env = {}) {
  const script = path.join(root, 'src', 'hooks', `${hookBase}.js`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    let stdout = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(stdinJson));
    child.stdin.end();
  });
}

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-hooks-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('hooks', () => {
  it('post-tool-use persists Read action and truncates huge output', async () => {
    const big = 'x'.repeat(20_000);
    const { code, stderr } = await runHook(
      'post-tool-use',
      {
        session_id: 'hook-s1',
        tool_name: 'Read',
        tool_input: { file_path: 'src/a.ts' },
        tool_response: big,
      },
      { CLAUDE_PROJECT_DIR: tmpDir, PICKLEJAR_PROJECT_DIR: tmpDir },
    );
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const snap = await loadSnapshot(tmpDir, 'hook-s1');
    expect(snap?.session.actions).toHaveLength(1);
    expect(snap?.session.actions[0].output.length).toBeLessThan(big.length);
    expect(snap?.session.activeFiles.some((f) => f.path === 'src/a.ts')).toBe(true);
  });

  it('pre-compact writes pre-compact snapshot', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'pc1',
        tool_name: 'Read',
        tool_input: { file_path: 'x' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: tmpDir },
    );
    const { code } = await runHook(
      'pre-compact',
      { session_id: 'pc1' },
      { CLAUDE_PROJECT_DIR: tmpDir },
    );
    expect(code).toBe(0);
    const snap = await loadSnapshot(tmpDir, 'pc1');
    expect(snap?.type).toBe('pre-compact');
  });

  it('session-end marks ended', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'end1',
        tool_name: 'Read',
        tool_input: { file_path: 'z' },
        tool_response: 'z',
      },
      { CLAUDE_PROJECT_DIR: tmpDir },
    );
    const { code } = await runHook('session-end', { session_id: 'end1' }, { CLAUDE_PROJECT_DIR: tmpDir });
    expect(code).toBe(0);
    const snap = await loadSnapshot(tmpDir, 'end1');
    expect(snap?.session.ended).toBe(true);
  });

  it('session-start extracts goal from transcript on startup', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const userLine = JSON.stringify({ role: 'user', content: 'Implement JWT authentication' });
    await fs.writeFile(transcriptPath, userLine + '\n', 'utf8');
    const { code } = await runHook(
      'session-start',
      { source: 'startup', session_id: 'goal-test', transcript_path: transcriptPath },
      { CLAUDE_PROJECT_DIR: tmpDir, PICKLEJAR_PROJECT_DIR: tmpDir },
    );
    expect(code).toBe(0);
    const snap = await loadSnapshot(tmpDir, 'goal-test');
    expect(snap?.session.goal).toBe('Implement JWT authentication');
  });

  it('session-start returns additionalContext on resume', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'rs1',
        tool_name: 'Write',
        tool_input: { file_path: 'f.txt', content: 'hello' },
        tool_response: 'written',
      },
      { CLAUDE_PROJECT_DIR: tmpDir },
    );
    const { code, stdout } = await runHook(
      'session-start',
      { source: 'resume', session_id: 'rs1' },
      { CLAUDE_PROJECT_DIR: tmpDir },
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout || '{}');
    expect(out.additionalContext).toContain('PICKLEJAR RESUME');
  });
});
