import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSession,
  addAction,
  updateTaskTree,
  setError,
  loadSession,
} from '../src/core/state.js';
import {
  saveSnapshot,
  loadSnapshot,
  decodeSnapshot,
  encodeSnapshot,
  cleanSnapshots,
  listSnapshots,
} from '../src/core/snapshot.js';
import { picklejarRoot } from '../src/core/paths.js';

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('state + snapshot', () => {
  it('creates, saves, loads session with integrity', async () => {
    const session = createSession('sess-1', tmpDir);
    session.goal = 'Ship feature';
    addAction(session, {
      id: 'a1',
      timestamp: Date.now(),
      toolName: 'Read',
      input: { file_path: 'x.ts' },
      output: 'ok',
      relatedFiles: ['x.ts'],
    });
    updateTaskTree(session, session.actions[0]);
    await saveSnapshot(session);

    const loaded = await loadSession(tmpDir, 'sess-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.sessionId).toBe('sess-1');
    expect(loaded?.goal).toBe('Ship feature');
    expect(loaded?.actions).toHaveLength(1);
    expect(loaded?.snapshotCount).toBeGreaterThanOrEqual(1);
  });

  it('caps actions at 200 (FIFO)', () => {
    const session = createSession('s', tmpDir);
    for (let i = 0; i < 205; i += 1) {
      addAction(session, {
        id: `id-${i}`,
        timestamp: i,
        toolName: 'Read',
        input: {},
        output: '',
        relatedFiles: [],
      });
    }
    expect(session.actions).toHaveLength(200);
    expect(session.actions[0].id).toBe('id-5');
  });

  it('falls back when snapshot checksum is wrong', async () => {
    const session = createSession('sess-bad', tmpDir);
    await saveSnapshot(session);
    await saveSnapshot({ ...session, goal: 'second' });

    const files = (await fs.readdir(path.join(picklejarRoot(tmpDir), 'snapshots'))).filter((f) =>
      f.endsWith('.bin'),
    );
    expect(files.length).toBeGreaterThanOrEqual(1);
    const newest = path.join(picklejarRoot(tmpDir), 'snapshots', files.sort().at(-1));
    const buf = await fs.readFile(newest);
    // Corrupt payload (after header)
    if (buf.length > 12) {
      buf[buf.length - 1] ^= 0xff;
      await fs.writeFile(newest, buf);
    }

    const loaded = await loadSnapshot(tmpDir, 'sess-bad');
    expect(loaded).not.toBeNull();
    expect(loaded?.session.goal === 'second' || loaded?.session.goal === '').toBe(true);
  });

  it('cleans old snapshots per session', async () => {
    const session = createSession('sess-clean', tmpDir);
    for (let i = 0; i < 5; i += 1) {
      session.goal = `v${i}`;
      await saveSnapshot(session);
    }
    await cleanSnapshots(tmpDir, 2, 'sess-clean');
    const dir = path.join(picklejarRoot(tmpDir), 'snapshots');
    const left = (await fs.readdir(dir)).filter((f) => f.startsWith('sess-clean'));
    expect(left.length).toBeLessThanOrEqual(2);
  });

  it('decodeSnapshot rejects invalid magic', () => {
    const bad = Buffer.from('XXXX');
    expect(() => decodeSnapshot(bad)).toThrow();
  });

  it('setError persists', async () => {
    const session = createSession('e1', tmpDir);
    setError(session, 'network');
    await saveSnapshot(session);
    const loaded = await loadSession(tmpDir, 'e1');
    expect(loaded?.lastError).toBe('network');
  });

  it('listSnapshots returns entries', async () => {
    const session = createSession('ls1', tmpDir);
    await saveSnapshot(session);
    const list = await listSnapshots(tmpDir);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('serializes concurrent saves with lock', async () => {
    const session = createSession('conc', tmpDir);
    await Promise.all([
      saveSnapshot({ ...session, goal: 'a' }),
      saveSnapshot({ ...session, goal: 'b' }),
      saveSnapshot({ ...session, goal: 'c' }),
    ]);
    const loaded = await loadSession(tmpDir, 'conc');
    expect(loaded).not.toBeNull();
    expect(['a', 'b', 'c']).toContain(loaded?.goal);
  });
});

describe('encode/decode roundtrip', () => {
  it('roundtrips', () => {
    const session = createSession('r1', '/tmp/p');
    const buf = encodeSnapshot(session, 'pre-compact');
    const { session: out, type } = decodeSnapshot(buf);
    expect(type).toBe('pre-compact');
    expect(out.sessionId).toBe('r1');
  });
});
