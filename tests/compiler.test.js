import { describe, it, expect } from 'vitest';
import { compileBrainDump, estimateTokens, listSelectableActions } from '../src/core/compiler.js';
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
    expect(md).toContain('USER ORIGINAL INTENT');
    expect(md).toContain('CURRENT TRUSTED STATE');
    expect(md).toContain('RECENT TRUSTED ACTIONS');
    expect(md).toContain('[PICKLEJAR RESUME]');
  });

  it('does not produce [object Object] when output/input are objects', () => {
    const s = createSession('obj-test', '/tmp/p');
    s.goal = 'Reproduce object bug';
    addAction(s, {
      id: '2',
      timestamp: Date.now(),
      toolName: 'Bash',
      input: { command: 'ls' },
      output: { content: [{ type: 'text', text: 'file.txt' }] },
      relatedFiles: [],
    });
    const md = compileBrainDump(s, { maxTokens: 50_000 });
    expect(md).not.toContain('[object Object]');
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

  it('omits disabled sections', () => {
    const s = createSession('sections', '/tmp/p');
    s.goal = 'Keep summary small';
    s.activeFiles.push({
      path: 'secret.txt',
      hash: 'h1',
      content: 'super secret',
      lastTouchedAt: Date.now(),
      lastAction: 'read',
    });
    const md = compileBrainDump(s, {
      maxTokens: 50_000,
      sections: {
        activeFiles: false,
        summarizedHistory: false,
      },
    });
    expect(md).not.toContain('## ACTIVE FILES');
    expect(md).not.toContain('## TRUSTED HISTORY');
    expect(md).toContain('## USER ORIGINAL INTENT');
  });

  it('excludes selected action indexes from rendered actions', () => {
    const s = createSession('filter-actions', '/tmp/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: {},
      output: 'alpha',
      relatedFiles: ['alpha.ts'],
    });
    addAction(s, {
      id: '2',
      timestamp: Date.now() + 1,
      toolName: 'Edit',
      input: {},
      output: 'beta',
      relatedFiles: ['beta.ts'],
    });
    addAction(s, {
      id: '3',
      timestamp: Date.now() + 2,
      toolName: 'Write',
      input: {},
      output: 'gamma',
      relatedFiles: ['gamma.ts'],
    });
    const md = compileBrainDump(s, { maxTokens: 50_000, excludeActionIndexes: [2] });
    expect(md).toContain('alpha.ts');
    expect(md).toContain('gamma.ts');
    expect(md).not.toContain('beta.ts');
  });

  it('lists selectable actions with stable 1-based indexes', () => {
    const s = createSession('list-actions', '/tmp/p');
    addAction(s, {
      id: '1',
      timestamp: 1700000000000,
      toolName: 'Read',
      input: { file: 'a' },
      output: 'a',
      relatedFiles: ['a.ts'],
    });
    addAction(s, {
      id: '2',
      timestamp: 1700000000100,
      toolName: 'Bash',
      input: { command: 'npm test' },
      output: 'ok',
      relatedFiles: [],
    });
    expect(listSelectableActions(s)).toEqual([
      {
        index: 1,
        id: '1',
        timestamp: 1700000000000,
        toolName: 'Read',
        summary: 'a.ts',
        curationStatus: 'default',
        includeInBrainDump: true,
        curationNote: '',
      },
      {
        index: 2,
        id: '2',
        timestamp: 1700000000100,
        toolName: 'Bash',
        summary: '{"command":"npm test"}',
        curationStatus: 'default',
        includeInBrainDump: true,
        curationNote: '',
      },
    ]);
  });

  it('omits persistently discarded actions by default', () => {
    const s = createSession('curated-filter', '/tmp/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: {},
      output: 'alpha',
      relatedFiles: ['alpha.ts'],
    });
    addAction(s, {
      id: '2',
      timestamp: Date.now() + 1,
      toolName: 'Edit',
      input: {},
      output: 'beta',
      relatedFiles: ['beta.ts'],
      curationStatus: 'hallucinated',
    });
    const md = compileBrainDump(s, { maxTokens: 50_000 });
    expect(md).toContain('alpha.ts');
    expect(md).not.toContain('beta.ts');
  });

  it('can ignore persistent curation filters explicitly', () => {
    const s = createSession('curated-override', '/tmp/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Edit',
      input: {},
      output: 'beta',
      relatedFiles: ['beta.ts'],
      includeInBrainDump: false,
      curationStatus: 'discarded',
    });
    const md = compileBrainDump(s, { maxTokens: 50_000, ignoreCuration: true });
    expect(md).toContain('beta.ts');
  });

  it('prioritizes confirmed actions under tight token budgets', () => {
    const s = createSession('curated-priority', '/tmp/p');
    for (let i = 0; i < 20; i += 1) {
      addAction(s, {
        id: String(i),
        timestamp: 1700000000000 + i,
        toolName: 'Read',
        input: {},
        output: `output-${i}-${'x'.repeat(250)}`,
        relatedFiles: [`file-${i}.ts`],
        curationStatus: i === 0 ? 'confirmed' : 'default',
      });
    }
    const md = compileBrainDump(s, { maxTokens: 180 });
    expect(md).toContain('output-0-');
  });

  it('can include discarded paths when requested', () => {
    const s = createSession('discarded-paths', '/tmp/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Edit',
      input: {},
      output: 'beta',
      relatedFiles: ['beta.ts'],
      curationStatus: 'hallucinated',
      curationNote: 'wrong assumption',
    });
    const md = compileBrainDump(s, {
      maxTokens: 50_000,
      sections: { discardedPaths: true },
    });
    expect(md).toContain('## DISCARDED PATHS');
    expect(md).toContain('wrong assumption');
  });
});
