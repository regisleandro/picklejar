import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from '../src/core/snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));

function runHook(name, stdinJson, env = {}) {
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
    child.stdin.write(JSON.stringify(stdinJson));
    child.stdin.end();
  });
}

let tmp;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pj-stop-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('stop hook', () => {
  it('resolves conversation_id as session id', async () => {
    await runHook(
      'post-tool-use',
      {
        conversation_id: 'conv1',
        tool_name: 'Read',
        tool_input: { file_path: 'a' },
        tool_response: 'x',
      },
      { PICKLEJAR_PROJECT_DIR: tmp },
    );
    const { code } = await runHook(
      'stop',
      { conversation_id: 'conv1' },
      { PICKLEJAR_PROJECT_DIR: tmp },
    );
    expect(code).toBe(0);
    const snap = await loadSnapshot(tmp, 'conv1');
    expect(snap?.type).toBe('stop');
  });
});
