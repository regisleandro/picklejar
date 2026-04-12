import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractGoalFromTranscript } from '../src/core/transcript.js';
import { deriveSessionTitle } from '../src/core/list-summary.js';
import { createSession } from '../src/core/state.js';

describe('transcript goal to derived title', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-transcript-title-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('deriveSessionTitle cleans goal from JSONL when content uses user_query wrappers', async () => {
    const line = JSON.stringify({
      message: { role: 'user', content: '<user_query>\nhello from transcript\n</user_query>' },
    });
    const p = path.join(tmpDir, 't.jsonl');
    await fs.writeFile(p, `${line}\n`, 'utf8');
    const goal = await extractGoalFromTranscript(p);
    expect(goal).toContain('<user_query>');
    const s = createSession('x', tmpDir);
    s.goal = goal ?? '';
    expect(deriveSessionTitle(s)).toBe('hello from transcript');
  });
});
