import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProjectDirFromEnv, getTranscriptPathFromEnv as transcriptFromEnv } from '../core/env.js';

/**
 * @returns {Promise<string>}
 */
export async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readStdinJson() {
  const raw = await readStdin();
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function getProjectDir() {
  return getProjectDirFromEnv();
}

export function getTranscriptPathFromEnv() {
  return transcriptFromEnv();
}

/**
 * Directory containing packaged hook scripts (development / npm package).
 */
export function packageHooksDir() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return here;
}

/**
 * @param {unknown} err
 */
export function logErr(err) {
  console.error('[picklejar]', err);
}
