#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadSnapshot, listSnapshots, saveSnapshot } from './core/snapshot.js';
import { compileBrainDump } from './core/compiler.js';
import { defaultConfig, loadConfig } from './core/config.js';
import {
  picklejarRoot,
  hooksTargetDir,
  forceResumePath,
  snapshotsDir,
  transcriptsDir,
} from './core/paths.js';
import { runHookScript, claudeHooksBlock } from './core/init-templates.js';

function getPackageRoot() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

/**
 * @param {unknown} hooks
 */
function hasPicklejarRunHook(hooks) {
  try {
    return JSON.stringify(hooks ?? {}).includes('.picklejar/hooks/run-hook.js');
  } catch {
    return false;
  }
}

/**
 * @param {unknown} hooks
 */
function hasStartupMatcher(hooks) {
  try {
    return JSON.stringify(/** @type {any} */ (hooks)?.SessionStart ?? []).includes('"startup"');
  } catch {
    return false;
  }
}

/**
 * @param {string} projectDir
 */
async function mergeClaudeSettings(projectDir) {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  let existing = { hooks: {} };
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    existing = JSON.parse(raw);
  } catch {
    /* new file */
  }
  existing.hooks = existing.hooks ?? {};
  if (hasPicklejarRunHook(existing.hooks) && hasStartupMatcher(existing.hooks)) {
    return false;
  }
  const block = claudeHooksBlock();
  if (hasPicklejarRunHook(existing.hooks) && !hasStartupMatcher(existing.hooks)) {
    // Partial merge: only add the missing startup entry
    const startupEntries = block.SessionStart.filter((e) =>
      JSON.stringify(e).includes('"startup"'),
    );
    existing.hooks.SessionStart = [...(existing.hooks.SessionStart ?? []), ...startupEntries];
    await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
    return 'startup-added';
  }
  for (const [event, arr] of Object.entries(block)) {
    existing.hooks[event] = [...(existing.hooks[event] ?? []), ...arr];
  }
  await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2), 'utf8');
  return true;
}

/**
 * @param {string} projectRoot
 */
async function ensureGitignoreEntries(projectRoot) {
  const gi = path.join(projectRoot, '.gitignore');
  const lines = [
    '',
    '# picklejar',
    '.picklejar/snapshots/',
    '.picklejar/transcripts/',
    '.picklejar/.picklejar.lock',
    '.picklejar/force-resume.json',
  ];
  let content = '';
  try {
    content = await fs.readFile(gi, 'utf8');
  } catch {
    content = '';
  }
  let next = content;
  for (const line of lines) {
    if (line && !next.includes(line.trim())) {
      next += (next.endsWith('\n') || next.length === 0 ? '' : '\n') + line + '\n';
    }
  }
  if (next !== content) await fs.writeFile(gi, next, 'utf8');
}

const program = new Command();

program
  .name('picklejar')
  .description('Persist Claude Code sessions via native hooks')
  .version(
    JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
  );

program
  .command('init')
  .description('Create .picklejar, install run-hook, register Claude Code hooks')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (dir) => {
    const projectDir = path.resolve(dir);
    const pkgRoot = getPackageRoot();
    await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
    await fs.mkdir(hooksTargetDir(projectDir), { recursive: true });
    await fs.mkdir(snapshotsDir(projectDir), { recursive: true });
    await fs.mkdir(transcriptsDir(projectDir), { recursive: true });

    const cfgPath = path.join(picklejarRoot(projectDir), 'config.json');
    try {
      await fs.access(cfgPath);
    } catch {
      await fs.writeFile(cfgPath, JSON.stringify(defaultConfig(), null, 2), 'utf8');
    }

    const runHookPath = path.join(hooksTargetDir(projectDir), 'run-hook.js');
    await fs.writeFile(runHookPath, runHookScript(pkgRoot), 'utf8');
    await fs.chmod(runHookPath, 0o755);

    const merged = await mergeClaudeSettings(projectDir);
    await ensureGitignoreEntries(projectDir);

    console.log(`Picklejar initialized in ${projectDir}`);
    if (merged === 'startup-added') {
      console.log('Claude settings.json updated (startup matcher added to existing hooks).');
    } else {
      console.log(merged ? 'Claude settings.json updated (hooks appended).' : 'Claude hooks already present; settings unchanged.');
    }
  });

program
  .command('status')
  .description('Show latest session snapshot summary')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (dir) => {
    const projectDir = path.resolve(dir);
    const latest = await loadSnapshot(projectDir);
    if (!latest) {
      console.log('No snapshots found.');
      return;
    }
    const s = latest.session;
    console.log(`Session: ${s.sessionId}`);
    console.log(`Last snapshot file: ${latest.file} (${latest.type})`);
    console.log(`Actions: ${s.actions?.length ?? 0} | Snapshots (counter): ${s.snapshotCount}`);
    console.log(`Goal: ${s.goal || '(empty)'}`);
    console.log(`Ended: ${s.ended ? 'yes' : 'no'}`);
  });

program
  .command('list')
  .description('List snapshot files')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (dir) => {
    const projectDir = path.resolve(dir);
    const rows = await listSnapshots(projectDir);
    if (!rows.length) {
      console.log('No snapshots.');
      return;
    }
    for (const r of rows) {
      console.log(`${r.sessionId}\t${r.file}\t${new Date(r.mtimeMs).toISOString()}`);
    }
  });

program
  .command('inspect')
  .description('Print session JSON (pretty)')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (id, dir) => {
    const projectDir = path.resolve(dir);
    const loaded = await loadSnapshot(projectDir, id);
    if (!loaded) {
      console.error('Session not found');
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(loaded.session, null, 2));
  });

const exportCmd = program
  .command('export')
  .description('Write brain dump markdown for a session')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .option('-o, --out <file>', 'output .md path (default: .picklejar/export-<id>.md)');

exportCmd.action(async (id, dir) => {
    const projectDir = path.resolve(dir);
    const outOpt = exportCmd.opts().out;
    const outPath = outOpt
      ? path.isAbsolute(outOpt)
        ? outOpt
        : path.join(projectDir, outOpt)
      : path.join(projectDir, '.picklejar', `export-${id}.md`);
    const loaded = await loadSnapshot(projectDir, id);
    if (!loaded) {
      console.error('Session not found');
      process.exitCode = 1;
      return;
    }
    const cfg = await loadConfig(projectDir);
    const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, md, 'utf8');
    console.log(`Wrote ${outPath}`);
  });

const resumeCmd = program
  .command('resume')
  .description('Force brain dump injection on next SessionStart (resume)')
  .option('--id <id>', 'session id (default: latest any)')
  .argument('[dir]', 'project directory', process.cwd());

resumeCmd.action(async (dir) => {
    const projectDir = path.resolve(dir);
    let sessionId = resumeCmd.opts().id;
    if (!sessionId) {
      const rows = await listSnapshots(projectDir);
      sessionId = rows.at(-1)?.sessionId;
    }
    if (!sessionId) {
      console.error('No session id available');
      process.exitCode = 1;
      return;
    }
    await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
    await fs.writeFile(
      forceResumePath(projectDir),
      JSON.stringify({ sessionId, at: Date.now() }, null, 2),
      'utf8',
    );
    console.log(`Resume flag set for session ${sessionId}`);
  });

program
  .command('goal')
  .description('Set the goal on the latest session snapshot')
  .argument('<text>', 'goal text')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (text, dir) => {
    const projectDir = path.resolve(dir);
    const loaded = await loadSnapshot(projectDir);
    if (!loaded) {
      console.error('No session found');
      process.exitCode = 1;
      return;
    }
    loaded.session.goal = text;
    await saveSnapshot(loaded.session);
    console.log(`Goal set on session ${loaded.session.sessionId}: ${text}`);
  });

program
  .command('decide')
  .description('Add an architecture decision to the latest session snapshot')
  .argument('<description>', 'decision description')
  .argument('<reasoning>', 'why this decision was made')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (description, reasoning, dir) => {
    const projectDir = path.resolve(dir);
    const loaded = await loadSnapshot(projectDir);
    if (!loaded) {
      console.error('No session found');
      process.exitCode = 1;
      return;
    }
    loaded.session.decisions = loaded.session.decisions ?? [];
    loaded.session.decisions.push({ description, reasoning, timestamp: Date.now() });
    await saveSnapshot(loaded.session);
    console.log(`Decision added to session ${loaded.session.sessionId}: ${description}`);
  });

const cleanCmd = program
  .command('clean')
  .description('Remove old snapshot files')
  .option('--keep <n>', 'keep last N per session', '50')
  .argument('[dir]', 'project directory', process.cwd());

cleanCmd.action(async (dir) => {
    const projectDir = path.resolve(dir);
    const keep = Number(cleanCmd.opts().keep) || 50;
    const rows = await listSnapshots(projectDir);
    const bySession = new Map();
    for (const r of rows) {
      if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, []);
      bySession.get(r.sessionId).push(r.file);
    }
    for (const [sid, files] of bySession) {
      const sorted = files.sort();
      const toDrop = sorted.slice(0, Math.max(0, sorted.length - keep));
      for (const f of toDrop) {
        try {
          await fs.unlink(path.join(snapshotsDir(projectDir), f));
        } catch {
          /* ignore */
        }
      }
    }
    console.log('Cleanup done.');
  });

program.parseAsync(process.argv);
