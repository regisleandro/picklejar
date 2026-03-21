import path from 'node:path';

/**
 * Cursor, Claude Code, and explicit override set project dir.
 */
export function getProjectDirFromEnv() {
  const fromEnv =
    process.env.CURSOR_PROJECT_DIR ??
    process.env.CLAUDE_PROJECT_DIR ??
    process.env.PICKLEJAR_PROJECT_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return process.cwd();
}

/**
 * Best-effort transcript path from hook env (Cursor) or undefined.
 */
export function getTranscriptPathFromEnv() {
  const tp = process.env.CURSOR_TRANSCRIPT_PATH;
  return typeof tp === 'string' && tp ? tp : undefined;
}
