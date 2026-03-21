import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  writeResumeSection,
  cleanResumeSection,
  PICKLEJAR_RESUME_START,
} from '../src/adapters/markdown-inject.js';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pj-md-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('markdown-inject', () => {
  it('writes and cleans resume section in nested file', async () => {
    await writeResumeSection(dir, 'nested/AGENTS.md', '# dump');
    const raw = await fs.readFile(path.join(dir, 'nested/AGENTS.md'), 'utf8');
    expect(raw).toContain(PICKLEJAR_RESUME_START);
    expect(raw).toContain('# dump');
    await cleanResumeSection(dir, 'nested/AGENTS.md');
    const after = await fs.readFile(path.join(dir, 'nested/AGENTS.md'), 'utf8').catch(() => '');
    expect(after).not.toContain(PICKLEJAR_RESUME_START);
  });
});
