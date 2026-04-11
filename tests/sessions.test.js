import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, addAction } from '../src/core/state.js';
import { saveSnapshot } from '../src/core/snapshot.js';
import {
  listSessions,
  loadSessionDetail,
  deriveSessionStatus,
  collectSessionFiles,
  buildSessionViewModel,
} from '../src/core/sessions.js';
import { deriveSessionTitle } from '../src/core/list-summary.js';

describe('sessions', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-sessions-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('listSessions groups snapshots and lists each session once', async () => {
    const s1 = createSession('session-alpha', tmpDir);
    s1.goal = 'First goal';
    await saveSnapshot(s1);
    s1.goal = 'First goal updated';
    await saveSnapshot(s1);

    const s2 = createSession('session-beta', tmpDir);
    s2.goal = 'Second goal';
    await saveSnapshot(s2);

    const list = await listSessions(tmpDir);
    const ids = list.map((r) => r.sessionId).sort();
    expect(ids).toEqual(['session-alpha', 'session-beta']);
    const alpha = list.find((r) => r.sessionId === 'session-alpha');
    expect(alpha?.snapshotsCount).toBe(2);
    expect(alpha?.title).toContain('First goal');
  });

  it('listSessions sorts by updatedAt descending', async () => {
    const older = createSession('old-sess', tmpDir);
    older.goal = 'Old';
    await saveSnapshot(older);

    const newer = createSession('new-sess', tmpDir);
    newer.goal = 'New';
    await saveSnapshot(newer);

    const list = await listSessions(tmpDir);
    expect(list[0].sessionId).toBe('new-sess');
    expect(list[1].sessionId).toBe('old-sess');
  });

  it('deriveSessionStatus reflects ended, lastError, and active', () => {
    const base = createSession('x', '/p');
    expect(deriveSessionStatus(base)).toBe('active');

    const ended = createSession('x', '/p');
    ended.ended = true;
    expect(deriveSessionStatus(ended)).toBe('ended');

    const err = createSession('x', '/p');
    err.lastError = 'boom';
    expect(deriveSessionStatus(err)).toBe('error');
  });

  it('deriveSessionTitle uses goal when set', () => {
    const s = createSession('abc12345', '/p');
    s.goal = 'My important goal';
    expect(deriveSessionTitle(s)).toBe('My important goal');
  });

  it('deriveSessionTitle never uses raw tool name as title', () => {
    const s = createSession('sessidxx', '/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: {},
      output: 'ok',
      relatedFiles: [],
    });
    const t = deriveSessionTitle(s);
    expect(t).not.toBe('Read');
    expect(t.startsWith('Session ')).toBe(true);
  });

  it('deriveSessionTitle falls back to Session prefix', () => {
    const s = createSession('abcdefgh', '/p');
    expect(deriveSessionTitle(s)).toBe('Session abcdefgh');
    const short = createSession('ab', '/p');
    expect(deriveSessionTitle(short)).toBe('Session ab');
  });

  it('collectSessionFiles deduplicates and limits to 10', () => {
    const s = createSession('x', '/p');
    for (let i = 0; i < 15; i += 1) {
      s.activeFiles.push({
        path: `f${i}.ts`,
        hash: 'h',
        content: '',
        lastTouchedAt: Date.now(),
        lastAction: 'read',
      });
    }
    const files = collectSessionFiles(s, 10);
    expect(files.length).toBe(10);
    expect(new Set(files).size).toBe(10);
  });

  it('buildSessionViewModel includes curationStats shape', () => {
    const s = createSession('vm', '/p');
    addAction(s, {
      id: '1',
      timestamp: Date.now(),
      toolName: 'Bash',
      input: { command: 'ls' },
      output: 'out',
      relatedFiles: ['a.ts'],
    });
    const vm = buildSessionViewModel(s, 3);
    expect(vm.sessionId).toBe('vm');
    expect(vm.snapshotsCount).toBe(3);
    expect(vm.curationStats).toMatchObject({
      total: 1,
      included: expect.any(Number),
      excluded: expect.any(Number),
      suggested: expect.any(Number),
      byStatus: expect.any(Object),
    });
  });

  it('loadSessionDetail returns latest session', async () => {
    const s = createSession('detail-me', tmpDir);
    s.goal = 'v1';
    await saveSnapshot(s);
    s.goal = 'v2';
    await saveSnapshot(s);
    const loaded = await loadSessionDetail(tmpDir, 'detail-me');
    expect(loaded?.goal).toBe('v2');
  });
});
