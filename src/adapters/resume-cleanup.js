import { cleanResumeSection } from './markdown-inject.js';

const MARKDOWN_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONVENTIONS.md'];
const ANTIGRAVITY_RESUME = '.agent/picklejar-resume.md';

/**
 * Remove picklejar resume markers from all known instruction files.
 * @param {string} projectDir
 */
export async function cleanAllResumeInjections(projectDir) {
  for (const f of MARKDOWN_FILES) {
    await cleanResumeSection(projectDir, f);
  }
  await cleanResumeSection(projectDir, ANTIGRAVITY_RESUME);
}
