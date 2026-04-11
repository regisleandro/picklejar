import { execSync } from 'node:child_process';
import path from 'node:path';
import { loadSnapshot } from '../core/snapshot.js';
import { compileHumanSummary } from '../core/human-summary.js';

/**
 * @param {string} text
 */
export function copyToClipboard(text) {
  const platform = process.platform;
  if (platform === 'darwin') {
    execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'pipe'] });
    return;
  }
  if (platform === 'win32') {
    execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'pipe'], shell: true });
    return;
  }
  try {
    execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'pipe'] });
  } catch {
    execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'pipe'] });
  }
}

/**
 * @param {import('commander').Command} program
 */
export function registerSummaryCommand(program) {
  const summaryCmd = program
    .command('summary')
    .description('Print a short human-readable markdown summary for a session')
    .argument('<id>', 'session id')
    .argument('[dir]', 'project directory', process.cwd())
    .option('--json', 'output JSON with humanSummary field')
    .option('--copy', 'copy summary to clipboard (summary still printed to stdout)');

  summaryCmd.action(async (id, dir) => {
    const opts = summaryCmd.opts();
    const projectDir = path.resolve(dir);
    const loaded = await loadSnapshot(projectDir, id);
    if (!loaded) {
      console.error('Session not found');
      process.exitCode = 1;
      return;
    }
    const md = compileHumanSummary(loaded.session);
    if (opts.json) {
      console.log(JSON.stringify({ humanSummary: md }, null, 2));
    } else {
      process.stdout.write(md);
    }
    if (opts.copy) {
      try {
        copyToClipboard(md);
        console.error('Copied to clipboard.');
      } catch (e) {
        console.error(/** @type {Error} */ (e).message || e);
        process.exitCode = 1;
      }
    }
  });
}
