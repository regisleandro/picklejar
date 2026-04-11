import path from 'node:path';

export function getProjectDirFromEnv() {
  const fromEnv =
    process.env.CURSOR_PROJECT_DIR ??
    process.env.CLAUDE_PROJECT_DIR ??
    process.env.PICKLEJAR_PROJECT_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return process.cwd();
}

export function getTranscriptPathFromEnv() {
  const tp = process.env.CURSOR_TRANSCRIPT_PATH;
  return typeof tp === 'string' && tp ? tp : undefined;
}
