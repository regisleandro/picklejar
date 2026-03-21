import { writeResumeSection, cleanResumeSection } from './markdown-inject.js';

export async function writeResumeToAgentsMd(projectDir, brainDump) {
  await writeResumeSection(projectDir, 'AGENTS.md', brainDump);
}

export async function cleanResumeFromAgentsMd(projectDir) {
  await cleanResumeSection(projectDir, 'AGENTS.md');
}
