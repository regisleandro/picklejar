import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {unknown} hooks
 */
export function hasPicklejarRunHook(hooks) {
  try {
    return JSON.stringify(hooks ?? {}).includes('.picklejar/hooks/run-hook.js');
  } catch {
    return false;
  }
}

/**
 * @param {unknown} hooks
 * @param {string} matcher
 */
export function hasSessionStartMatcher(hooks, matcher) {
  try {
    return JSON.stringify(/** @type {any} */ (hooks)?.SessionStart ?? []).includes(`"${matcher}"`);
  } catch {
    return false;
  }
}

/**
 * Merge Claude Code-style hooks (SessionStart, PostToolUse, …) into settings.json
 * @param {string} settingsPath - absolute path to settings.json
 * @param {Record<string, unknown>} block - e.g. claudeHooksBlock()
 * @returns {Promise<boolean | 'matchers-added'>}
 */
export async function mergeClaudeStyleHooks(settingsPath, block) {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  let existing = { hooks: {} };
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    existing = JSON.parse(raw);
  } catch {
    /* new */
  }
  existing.hooks = existing.hooks ?? {};

  const hasHook = hasPicklejarRunHook(existing.hooks);
  const hasStartup = hasSessionStartMatcher(existing.hooks, 'startup');
  const hasCompact = hasSessionStartMatcher(existing.hooks, 'compact');

  if (hasHook && hasStartup && hasCompact) {
    return false;
  }

  if (hasHook) {
    const missingMatchers = block.SessionStart.filter((e) => {
      const s = JSON.stringify(e);
      if (!hasStartup && s.includes('"startup"')) return true;
      if (!hasCompact && s.includes('"compact"')) return true;
      return false;
    });
    if (missingMatchers.length > 0) {
      existing.hooks.SessionStart = [...(existing.hooks.SessionStart ?? []), ...missingMatchers];
      await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
      return 'matchers-added';
    }
    return false;
  }

  for (const [event, arr] of Object.entries(block)) {
    existing.hooks[event] = [...(existing.hooks[event] ?? []), ...arr];
  }
  await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
  return true;
}

/**
 * Merge Cursor project hooks (.cursor/hooks.json)
 * @param {string} projectDir
 * @param {Record<string, unknown>} picklejarHooks - { version, hooks: { ... } }
 */
export async function mergeCursorHooksJson(projectDir, picklejarHooks) {
  const p = path.join(projectDir, '.cursor', 'hooks.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  let existing = { version: 1, hooks: {} };
  try {
    existing = JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    /* new */
  }
  existing.version = existing.version ?? 1;
  existing.hooks = existing.hooks ?? {};
  if (hasPicklejarRunHook(existing.hooks)) {
    return false;
  }
  const incoming = /** @type {any} */ (picklejarHooks).hooks ?? {};
  for (const [name, arr] of Object.entries(incoming)) {
    const cur = existing.hooks[name] ?? [];
    existing.hooks[name] = [...cur, .../** @type {any[]} */ (arr)];
  }
  await fs.writeFile(p, JSON.stringify(existing, null, 2), 'utf8');
  return true;
}
