import { writeResumeSection, cleanResumeSection } from './markdown-inject.js';

export async function writeResumeToClaude(projectDir, brainDump) {
  await writeResumeSection(projectDir, 'CLAUDE.md', brainDump);
}

export async function cleanResumeFromClaude(projectDir) {
  await cleanResumeSection(projectDir, 'CLAUDE.md');
}
