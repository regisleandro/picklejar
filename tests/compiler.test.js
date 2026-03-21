import { describe, it, expect } from 'vitest';
import { compileBrainDump, estimateTokens } from '../src/core/compiler.js';
import { createSession, addAction } from '../src/core/state.js';

describe('compiler', () => {
  it('includes objective and actions', () => {
    const s = createSession('c1', '/tmp/p');
    s.goal = 'Test goal';
    s.lastPlannedAction = 'Run tests';
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: {},
      output: 'out',
      relatedFiles: ['a.ts'],
    });
    const md = compileBrainDump(s, { maxTokens: 50_000 });
    expect(md).toContain('Test goal');
    expect(md).toContain('ÚLTIMAS AÇÕES');
    expect(md).toContain('[PICKLEJAR RESUME]');
  });

  it('respects maxTokens roughly', () => {
    const s = createSession('big', '/tmp/p');
    s.activeFiles.push({
      path: 'huge.txt',
      hash: 'x',
      content: 'z'.repeat(200_000),
      lastTouchedAt: Date.now(),
      lastAction: 'read',
    });
    const md = compileBrainDump(s, { maxTokens: 2000 });
    expect(estimateTokens(md)).toBeLessThan(4000);
  });
});
