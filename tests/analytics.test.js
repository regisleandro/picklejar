import { describe, it, expect } from 'vitest';
import { createSession, addAction } from '../src/core/state.js';
import { computeSessionInsights, sessionMatchesWindow, computeProjectInsights } from '../src/core/analytics.js';

describe('analytics', () => {
  it('computeSessionInsights returns stable shape for empty session', () => {
    const s = createSession('s1', '/p');
    const ins = computeSessionInsights(s);
    expect(ins.qualityScore).toBe(100);
    expect(ins.timelineChips).toEqual([]);
    expect(ins.display.successPct).toBe('100%');
  });

  it('computeSessionInsights detects rework on repeated relatedFiles', () => {
    const s = createSession('s1', '/p');
    addAction(s, {
      id: 'a1',
      timestamp: 1,
      toolName: 'read_file',
      input: {},
      output: 'ok',
      relatedFiles: ['src/foo.ts'],
    });
    addAction(s, {
      id: 'a2',
      timestamp: 2,
      toolName: 'write',
      input: {},
      output: 'ok',
      relatedFiles: ['src/foo.ts'],
    });
    const ins = computeSessionInsights(s);
    expect(ins.counts?.reworkActions).toBe(1);
    expect(ins.reworkRate).toBeGreaterThan(0);
  });

  it('sessionMatchesWindow filters by 7d', () => {
    const now = Date.now();
    expect(sessionMatchesWindow(now - 2 * 24 * 60 * 60 * 1000, '7d', now)).toBe(true);
    expect(sessionMatchesWindow(now - 10 * 24 * 60 * 60 * 1000, '7d', now)).toBe(false);
    expect(sessionMatchesWindow(now - 10 * 24 * 60 * 60 * 1000, 'all', now)).toBe(true);
  });

  it('computeProjectInsights aggregates by agent', () => {
    const a = computeSessionInsights(createSession('x', '/p'));
    const rows = [
      { agentOrigin: 'claude', sessionInsights: a },
      { agentOrigin: 'claude', sessionInsights: a },
      { agentOrigin: null, sessionInsights: a },
    ];
    const out = computeProjectInsights(rows);
    expect(out.agents.length).toBe(2);
    const claude = out.agents.find((r) => r.agentOrigin === 'claude');
    expect(claude?.sessionCount).toBe(2);
    const unk = out.agents.find((r) => r.agentOrigin === 'unknown');
    expect(unk?.sessionCount).toBe(1);
  });
});
