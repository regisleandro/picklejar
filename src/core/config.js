import fs from 'node:fs/promises';
import { configPath } from './paths.js';

/**
 * @typedef {Object} PicklejarConfig
 * @property {number} maxTokens
 * @property {string[]} redactPatterns
 */

/** @type {PicklejarConfig} */
const DEFAULTS = {
  maxTokens: 30000,
  redactPatterns: [
    'sk-[A-Za-z0-9]{20,}',
    'Bearer\\s+[A-Za-z0-9._-]+',
    'api[_-]?key["\']?\\s*[:=]\\s*["\'][^"\']+["\']',
  ],
};

/**
 * @param {string} projectDir
 * @returns {Promise<PicklejarConfig>}
 */
export async function loadConfig(projectDir) {
  try {
    const raw = await fs.readFile(configPath(projectDir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      redactPatterns: parsed.redactPatterns ?? DEFAULTS.redactPatterns,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @returns {PicklejarConfig}
 */
export function defaultConfig() {
  return { ...DEFAULTS, redactPatterns: [...DEFAULTS.redactPatterns] };
}
