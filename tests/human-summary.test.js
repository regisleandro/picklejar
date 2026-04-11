import { describe, it, expect } from 'vitest';
import { compileHumanSummary, formatRelativeTime } from '../src/core/human-summary.js';
import { createSession, addAction } from '../src/core/state.js';
import { deriveSessionTitle } from '../src/core/list-summary.js';

describe('human-summary', () => {
  it('matches deriveSessionTitle for heading', () => {
    const s = createSession('sid', '/p');
    s.goal = 'Fix the bug';
    const md = compileHumanSummary(s);
    expect(md).toContain(`## ${deriveSessionTitle(s)}`);
  });

  it('fits quick reading', () => {
    const s = createSession('x', '/p');
    s.goal = 'G';
    const lines = compileHumanSummary(s).split('\n').filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(25);
  });

  it('shows What was done for included actions', () => {
    const s = createSession('x', '/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: { path: 'a.ts' },
      output: 'ok',
      relatedFiles: ['src/a.ts'],
    });
    const md = compileHumanSummary(s);
    expect(md).toContain('### What was done');
    expect(md).toContain('src/a.ts');
  });

  it('shows Next action when lastPlannedAction exists', () => {
    const s = createSession('x', '/p');
    s.lastPlannedAction = 'Run the test suite';
    const md = compileHumanSummary(s);
    expect(md).toContain('### Next action');
    expect(md).toContain('Run the test suite');
  });

  it('omits Next action when empty', () => {
    const s = createSession('x', '/p');
    const md = compileHumanSummary(s);
    expect(md).not.toContain('### Next action');
  });

  it('shows Error when lastError exists', () => {
    const s = createSession('x', '/p');
    s.lastError = 'Connection failed';
    const md = compileHumanSummary(s);
    expect(md).toContain('### Error');
    expect(md).toContain('Connection failed');
  });

  it('omits Error when no lastError', () => {
    const s = createSession('x', '/p');
    const md = compileHumanSummary(s);
    expect(md).not.toContain('### Error');
  });

  it('does not include raw file content from activeFiles', () => {
    const s = createSession('x', '/p');
    s.activeFiles.push({
      path: 'secret.txt',
      hash: 'h',
      content: 'SECRET_BODY_SHOULD_NOT_APPEAR',
      lastTouchedAt: Date.now(),
      lastAction: 'read',
    });
    const md = compileHumanSummary(s);
    expect(md).not.toContain('SECRET_BODY_SHOULD_NOT_APPEAR');
  });

  it('does not include resume instructions or PICKLEJAR RESUME', () => {
    const s = createSession('x', '/p');
    s.goal = 'Work';
    const md = compileHumanSummary(s);
    expect(md).not.toContain('[PICKLEJAR RESUME]');
    expect(md).not.toContain('resuming a previous session');
    expect(md).not.toContain('MUST start by briefly acknowledging');
  });

  it('formatRelativeTime returns human phrases', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(formatRelativeTime(now.getTime() - 30_000, now)).toMatch(/sec ago/);
    expect(formatRelativeTime(now.getTime() - 120_000, now)).toMatch(/min ago/);
  });
});
