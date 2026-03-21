import fs from 'node:fs/promises';
import path from 'node:path';

const RESUME_START = '<!-- PICKLEJAR RESUME START -->';
const RESUME_END = '<!-- PICKLEJAR RESUME END -->';

function removeResumeSection(content) {
  const start = content.indexOf(RESUME_START);
  const end = content.indexOf(RESUME_END);
  if (start === -1 || end === -1) return content;
  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + RESUME_END.length).replace(/^\n+/, '\n');
  return before ? before + '\n' + after : after.trimStart();
}

export async function writeResumeToClaude(projectDir, brainDump) {
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  let existing = '';
  try {
    existing = await fs.readFile(claudeMdPath, 'utf8');
  } catch { /* new file */ }
  const stripped = removeResumeSection(existing);
  const section = `${RESUME_START}\n${brainDump}\n${RESUME_END}`;
  const newContent = stripped.trimStart()
    ? `${section}\n\n${stripped.trimStart()}`
    : `${section}\n`;
  await fs.writeFile(claudeMdPath, newContent, 'utf8');
}

export async function cleanResumeFromClaude(projectDir) {
  const claudeMdPath = path.join(projectDir, 'CLAUDE.md');
  let content = '';
  try {
    content = await fs.readFile(claudeMdPath, 'utf8');
  } catch { return; }
  const cleaned = removeResumeSection(content);
  if (cleaned.trim()) {
    await fs.writeFile(claudeMdPath, cleaned, 'utf8');
  } else {
    try { await fs.unlink(claudeMdPath); } catch { /* ignore */ }
  }
}
