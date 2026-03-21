/** @typedef {import('../types/index.d.ts').PicklejarSession} PicklejarSession */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Packr } from 'msgpackr';
import lockfile from 'proper-lockfile';
import { picklejarRoot, snapshotsDir } from './paths.js';

const MAGIC = Buffer.from('PJ01', 'ascii');
const VERSION = 1;
const packr = new Packr({ useRecords: false });

/**
 * @param {string} sessionId
 */
export function sanitizeSessionIdForFilename(sessionId) {
  return sessionId.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/**
 * @param {PicklejarSession} session
 * @param {string} [snapshotType]
 * @returns {Buffer}
 */
export function encodeSnapshot(session, snapshotType = 'default') {
  const payload = packr.pack({
    v: VERSION,
    type: snapshotType,
    savedAt: Date.now(),
    session,
  });
  const checksum = crc32(payload);
  const checksumBuf = Buffer.allocUnsafe(4);
  checksumBuf.writeUInt32LE(checksum >>> 0, 0);
  return Buffer.concat([MAGIC, checksumBuf, payload]);
}

/**
 * @param {Buffer} buf
 * @returns {{ type: string, savedAt: number, session: PicklejarSession }}
 */
export function decodeSnapshot(buf) {
  if (buf.length < MAGIC.length + 4 + 1) {
    throw new Error('Snapshot too small');
  }
  if (!buf.subarray(0, 4).equals(MAGIC)) {
    throw new Error('Invalid snapshot magic');
  }
  const expected = buf.readUInt32LE(4);
  const payload = buf.subarray(8);
  const actual = crc32(payload) >>> 0;
  if (actual !== expected) {
    throw new Error('Snapshot checksum mismatch');
  }
  const data = packr.unpack(payload);
  if (!data || data.v !== VERSION || !data.session) {
    throw new Error('Invalid snapshot payload');
  }
  return {
    type: data.type ?? 'default',
    savedAt: data.savedAt ?? 0,
    session: data.session,
  };
}

/**
 * @param {string} projectDir
 */
async function ensureDirs(projectDir) {
  await fs.mkdir(snapshotsDir(projectDir), { recursive: true });
}

/**
 * @param {string} projectDir
 * @returns {Promise<() => Promise<void>>}
 */
async function acquireLock(projectDir) {
  const root = picklejarRoot(projectDir);
  await fs.mkdir(root, { recursive: true });
  const lockTarget = path.join(root, '.picklejar.lock');
  await fs.writeFile(lockTarget, '', { flag: 'a' });
  return lockfile.lock(lockTarget, {
    retries: {
      retries: 20,
      factor: 2,
      minTimeout: 50,
      maxTimeout: 5000,
    },
  });
}

/**
 * @param {PicklejarSession} session
 * @param {string} [snapshotType]
 */
export async function saveSnapshot(session, snapshotType = 'default') {
  const projectDir = session.projectDir;
  const release = await acquireLock(projectDir);
  try {
    await ensureDirs(projectDir);
    bumpSnapshotCountInMemory(session);
    const body = encodeSnapshot(session, snapshotType);
    const safeId = sanitizeSessionIdForFilename(session.sessionId);
    const fileName = `${safeId}-${Date.now()}.bin`;
    const filePath = path.join(snapshotsDir(projectDir), fileName);
    await fs.writeFile(filePath, body);
    await cleanSnapshots(projectDir, 50, session.sessionId);
  } finally {
    await release();
  }
}

/**
 * @param {PicklejarSession} session
 */
function bumpSnapshotCountInMemory(session) {
  session.snapshotCount = (session.snapshotCount ?? 0) + 1;
  session.lastUpdatedAt = Date.now();
}

/**
 * @param {string} projectDir
 * @param {string} [sessionId]
 * @returns {Promise<string[]>}
 */
export async function listSnapshotFiles(projectDir, sessionId) {
  await ensureDirs(projectDir);
  const dir = snapshotsDir(projectDir);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const bins = names.filter((n) => n.endsWith('.bin'));
  if (!sessionId) {
    return bins.sort();
  }
  const prefix = `${sanitizeSessionIdForFilename(sessionId)}-`;
  return bins.filter((n) => n.startsWith(prefix)).sort();
}

/**
 * @param {string} projectDir
 * @param {string} [sessionId]
 * @returns {Promise<{ file: string, type: string, savedAt: number, session: PicklejarSession } | null>}
 */
export async function loadSnapshot(projectDir, sessionId) {
  if (sessionId) {
    const files = await listSnapshotFiles(projectDir, sessionId);
    for (let i = files.length - 1; i >= 0; i -= 1) {
      const file = files[i];
      const full = path.join(snapshotsDir(projectDir), file);
      try {
        const buf = await fs.readFile(full);
        const decoded = decodeSnapshot(buf);
        return { file, ...decoded };
      } catch {
        /* try previous */
      }
    }
    return null;
  }

  const rows = await listSnapshots(projectDir);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const file = rows[i].file;
    const full = path.join(snapshotsDir(projectDir), file);
    try {
      const buf = await fs.readFile(full);
      const decoded = decodeSnapshot(buf);
      return { file, ...decoded };
    } catch {
      /* try previous */
    }
  }
  return null;
}

/**
 * Alias for loadSnapshot returning session only (plan naming).
 * @param {string} projectDir
 * @param {string} [sessionId]
 */
export async function loadLatestSessionSnapshot(projectDir, sessionId) {
  const loaded = await loadSnapshot(projectDir, sessionId);
  return loaded?.session ?? null;
}

/**
 * @param {string} projectDir
 * @param {number} [keep]
 * @param {string} [sessionId] if set, only prune files for this session
 */
export async function cleanSnapshots(projectDir, keep = 50, sessionId) {
  const all = await listSnapshotFiles(projectDir, sessionId);
  if (all.length <= keep) return;
  const toDelete = sessionId ? all.slice(0, -keep) : pruneGlobal(all, keep);
  for (const name of toDelete) {
    try {
      await fs.unlink(path.join(snapshotsDir(projectDir), name));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Keep last `keep` files globally (by sorted name — timestamp suffix preserves order).
 * @param {string[]} sortedNames
 * @param {number} keep
 */
function pruneGlobal(sortedNames, keep) {
  if (sortedNames.length <= keep) return [];
  return sortedNames.slice(0, sortedNames.length - keep);
}

/**
 * @param {string} projectDir
 * @returns {Promise<{ file: string, sessionId: string, mtimeMs: number }[]>}
 */
export async function listSnapshots(projectDir) {
  const dir = snapshotsDir(projectDir);
  const names = await listSnapshotFiles(projectDir);
  const out = [];
  for (const file of names) {
    const full = path.join(dir, file);
    try {
      const st = await fs.stat(full);
      const base = file.replace(/\.bin$/, '');
      const sessionId = base.includes('-') ? base.slice(0, base.lastIndexOf('-')) : base;
      out.push({ file, sessionId, mtimeMs: st.mtimeMs });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * @param {string} content
 */
export function shortHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}
