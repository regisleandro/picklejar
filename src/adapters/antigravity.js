import { writeResumeSection, cleanResumeSection } from './markdown-inject.js';

const REL = '.agent/picklejar-resume.md';

export async function writeResumeToAntigravity(projectDir, brainDump) {
  await writeResumeSection(projectDir, REL, brainDump);
}

export async function cleanResumeFromAntigravity(projectDir) {
  await cleanResumeSection(projectDir, REL);
}
