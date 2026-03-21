import path from 'node:path';

/** @param {string} projectDir */
export function picklejarRoot(projectDir) {
  return path.join(projectDir, '.picklejar');
}

/** @param {string} projectDir */
export function snapshotsDir(projectDir) {
  return path.join(picklejarRoot(projectDir), 'snapshots');
}

/** @param {string} projectDir */
export function transcriptsDir(projectDir) {
  return path.join(picklejarRoot(projectDir), 'transcripts');
}

/** @param {string} projectDir */
export function hooksTargetDir(projectDir) {
  return path.join(picklejarRoot(projectDir), 'hooks');
}

/** @param {string} projectDir */
export function configPath(projectDir) {
  return path.join(picklejarRoot(projectDir), 'config.json');
}

/** @param {string} projectDir */
export function forceResumePath(projectDir) {
  return path.join(picklejarRoot(projectDir), 'force-resume.json');
}
