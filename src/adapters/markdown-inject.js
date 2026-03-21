import fs from 'node:fs/promises';
import path from 'node:path';

export const PICKLEJAR_RESUME_START = '<!-- PICKLEJAR RESUME START -->';
export const PICKLEJAR_RESUME_END = '<!-- PICKLEJAR RESUME END -->';

function removeResumeSection(content) {
  const start = content.indexOf(PICKLEJAR_RESUME_START);
  const end = content.indexOf(PICKLEJAR_RESUME_END);
  if (start === -1 || end === -1) return content;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + PICKLEJAR_RESUME_END.length).replace(/^\n+/, '\n');
  return before ? before + '\n' + after : after.trimStart();
}

/**
 * @param {string} projectDir
 * @param {string} relativePath - e.g. CLAUDE.md, AGENTS.md
 * @param {string} brainDump
 */
export async function writeResumeSection(projectDir, relativePath, brainDump) {
  const filePath = path.join(projectDir, relativePath);
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    /* new */
  }
  const stripped = removeResumeSection(existing);
  const section = `${PICKLEJAR_RESUME_START}\n${brainDump}\n${PICKLEJAR_RESUME_END}`;
  const newContent = stripped.trimStart()
    ? `${section}\n\n${stripped.trimStart()}`
    : `${section}\n`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, newContent, 'utf8');
}

/**
 * @param {string} projectDir
 * @param {string} relativePath
 */
export async function cleanResumeSection(projectDir, relativePath) {
  const filePath = path.join(projectDir, relativePath);
  let content = '';
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return;
  }
  const cleaned = removeResumeSection(content);
  if (cleaned.trim()) {
    await fs.writeFile(filePath, cleaned, 'utf8');
  } else {
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore */
    }
  }
}
