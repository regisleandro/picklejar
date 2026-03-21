import { writeResumeSection, cleanResumeSection } from './markdown-inject.js';

export async function writeResumeToConventions(projectDir, brainDump) {
  await writeResumeSection(projectDir, 'CONVENTIONS.md', brainDump);
}

export async function cleanResumeFromConventions(projectDir) {
  await cleanResumeSection(projectDir, 'CONVENTIONS.md');
}
