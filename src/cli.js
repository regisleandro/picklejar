#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { loadSnapshot, listSnapshots, saveSnapshot } from './core/snapshot.js';
import { compileBrainDump } from './core/compiler.js';
import { loadConfig } from './core/config.js';
import { picklejarRoot, forceResumePath, resumeContextPath, snapshotsDir } from './core/paths.js';
import {
  AGENT_IDS,
  CAPABILITIES,
  parseInitArgs,
  runAgentInit,
  injectResumeContext,
  spawnAgent,
} from './agents/registry.js';

function getPackageRoot() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return path.resolve(here, '..');
}

const program = new Command();

program
  .name('picklejar')
  .description('Persist AI agent sessions via hooks and resume brain dumps (multi-agent)')
  .version(
    JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version,
  );

program
  .command('init')
  .description(
    'Create .picklejar, install run-hook, register hooks for the chosen agent (default: claude)',
  )
  .argument('[agent]', `agent: ${AGENT_IDS.join(', ')}`, 'claude')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (agentArg, dirArg) => {
    try {
      const { agent, dir: projectDir } = parseInitArgs(agentArg, dirArg);
      const pkgRoot = getPackageRoot();
      const detail = await runAgentInit(agent, projectDir, pkgRoot);
      console.log(`Picklejar initialized in ${projectDir} (${agent})`);
      console.log(detail);
    } catch (e) {
      console.error(/** @type {Error} */ (e).message || e);
      process.exitCode = 1;
    }
  });

program
  .command('capabilities')
  .description('Show supported agents and integration track')
  .argument('[agent]', 'optional agent id')
  .action((agent) => {
    if (agent) {
      const c = CAPABILITIES[agent];
      if (!c) {
        console.error(`Unknown agent. Use one of: ${AGENT_IDS.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ id: agent, ...c }, null, 2));
      return;
    }
    const table = Object.fromEntries(
      AGENT_IDS.map((id) => [id, CAPABILITIES[id]]),
    );
    console.log(JSON.stringify(table, null, 2));
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
  .description('Prepare session resume: write brain dump and set force-resume flag')
  .option('--id <id>', 'session id (default: latest)')
  .argument('[id]', 'session id (positional)')
  .argument('[dir]', 'project directory', process.cwd());

resumeCmd.action(async (idArg, dir) => {
  const projectDir = path.resolve(dir);
  let sessionId = idArg || resumeCmd.opts().id;
  if (!sessionId) {
    const rows = await listSnapshots(projectDir);
    sessionId = rows.at(-1)?.sessionId;
  }
  if (!sessionId) {
    console.error('No session id available');
    process.exitCode = 1;
    return;
  }
  const loaded = await loadSnapshot(projectDir, sessionId);
  if (!loaded) {
    console.error('Session not found');
    process.exitCode = 1;
    return;
  }
  const cfg = await loadConfig(projectDir);
  const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens });

  await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
  await fs.writeFile(resumeContextPath(projectDir), md, 'utf8');
  await fs.writeFile(
    forceResumePath(projectDir),
    JSON.stringify({ sessionId, at: Date.now() }, null, 2),
    'utf8',
  );
  console.log(`Resume prepared for session ${sessionId}`);
  console.log(`Run: picklejar start <agent>   (see: picklejar capabilities)`);
});

program
  .command('start')
  .description('Start an agent with resumed session context injected (when resume-context exists)')
  .argument('[agent]', `agent: ${AGENT_IDS.join(', ')}`, 'claude')
  .argument('[dir]', 'project directory', process.cwd())
  .action(async (agent, dir) => {
    const projectDir = path.resolve(dir);
    if (!AGENT_IDS.includes(agent)) {
      console.error(`Unknown agent '${agent}'. Run: picklejar capabilities`);
      process.exitCode = 1;
      return;
    }
    const injected = await injectResumeContext(agent, projectDir);
    if (injected) {
      console.log('Resume context injected for', agent);
    }
    spawnAgent(agent, projectDir);
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
  for (const [_sid, files] of bySession) {
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
