#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import * as readlineUi from 'node:readline';
import { Command } from 'commander';
import { loadSnapshot, listSnapshots, readSnapshotFile, saveSnapshot } from './core/snapshot.js';
import { compileBrainDump, listSelectableActions } from './core/compiler.js';
import { loadConfig } from './core/config.js';
import {
  CURATION_PROFILES,
  normalizeCurationProfile,
} from './core/curation.js';
import { picklejarRoot, forceResumePath, resumeContextPath, snapshotsDir } from './core/paths.js';
import { summarizeSessionForList } from './core/list-summary.js';
import { listSessions } from './core/sessions.js';
import { formatRelativeTime } from './core/human-summary.js';
import { registerExploreCommand } from './commands/explore.js';
import { registerSummaryCommand } from './commands/summary.js';
import { openSessionInAgent } from './core/resume-service.js';
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

/**
 * @param {string | number} s
 * @param {number} width
 */
function clipCell(s, width) {
  const str = String(s);
  if (str.length <= width) return str.padEnd(width);
  return `${str.slice(0, Math.max(0, width - 2))}..`;
}

/**
 * @param {string} projectDir
 * @param {{ verbose?: boolean, sections?: boolean }} opts
 */
async function listSnapshotsLegacy(projectDir, opts) {
  const rows = await listSnapshots(projectDir);
  if (!rows.length) {
    console.log('No snapshots.');
    return;
  }

  const includeSummary = Boolean(opts.verbose || opts.sections);
  for (const r of rows) {
    const base = includeSummary
      ? [`${r.sessionId}`, `${new Date(r.mtimeMs).toISOString()}`]
      : [`${r.sessionId}`, `${r.file}`, `${new Date(r.mtimeMs).toISOString()}`];
    if (!includeSummary) {
      console.log(base.join('\t'));
      continue;
    }

    const loaded = await readSnapshotFile(projectDir, r.file);
    if (!loaded) {
      const extras = [];
      if (opts.verbose) extras.push('(unreadable snapshot)', '?', '?');
      if (opts.sections) extras.push('[]');
      console.log(base.concat(extras).join('\t'));
      continue;
    }

    const summary = summarizeSessionForList(loaded.session);
    const extras = [];
    if (opts.verbose) {
      extras.push(summary.title, String(summary.actionsCount), summary.ended ? 'yes' : 'no');
    }
    if (opts.sections) {
      extras.push(`[${summary.sections.join(', ')}]`);
    }
    console.log(base.concat(extras).join('\t'));
  }
}

/**
 * @param {string} projectDir
 * @param {boolean} verbose
 */
async function printSessionList(projectDir, verbose) {
  const sessions = await listSessions(projectDir);
  if (!sessions.length) {
    console.log('No sessions.');
    return;
  }
  const idWidth = Math.max('SESSION ID'.length, ...sessions.map((session) => session.sessionId.length));
  const titleWidth = 80;
  const statusWidth = 10;
  const updatedWidth = 14;
  console.log(`Sessions found: ${sessions.length}\n`);
  if (verbose) {
    for (const s of sessions) {
      console.log(`${s.sessionId}  ${s.title}`);
      const rel = formatRelativeTime(s.updatedAt);
      console.log(`        status: ${s.status} | ${rel} | ${s.actionsCount} actions`);
      const topFiles = s.activeFiles.slice(0, 3).map((f) => path.basename(f));
      if (topFiles.length) {
        console.log(`        files: ${topFiles.join(', ')}`);
      }
      if (s.lastPlannedAction) {
        console.log(`        next action: ${s.lastPlannedAction}`);
      }
      if (s.errorSummary) {
        console.log(`        error: ${s.errorSummary}`);
      }
      console.log('');
    }
  } else {
    console.log(
      `${clipCell('SESSION ID', idWidth)}  ${clipCell('TITLE', titleWidth)}  ${clipCell('STATUS', statusWidth)}  ${clipCell('UPDATED', updatedWidth)}  ACTIONS`,
    );
    for (const s of sessions) {
      const rel = formatRelativeTime(s.updatedAt);
      console.log(
        `${clipCell(s.sessionId, idWidth)}  ${clipCell(s.title, titleWidth)}  ${clipCell(s.status, statusWidth)}  ${clipCell(rel, updatedWidth)}  ${s.actionsCount} actions`,
      );
    }
  }
}

const SECTION_FLAGS = [
  { option: 'withoutGoal', section: 'goal' },
  { option: 'withoutNextAction', section: 'nextPlannedAction' },
  { option: 'withoutError', section: 'lastError' },
  { option: 'withoutProgress', section: 'progress' },
  { option: 'withoutDecisions', section: 'decisions' },
  { option: 'withoutActiveFiles', section: 'activeFiles' },
  { option: 'withoutRecentActions', section: 'recentActions' },
  { option: 'withoutHistory', section: 'summarizedHistory' },
  { option: 'withoutInstructions', section: 'resumeInstructions' },
];

/**
 * @param {string | undefined} raw
 */
function parseActionIndexes(raw) {
  if (!raw) return [];
  return [...new Set(raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

/**
 * @param {Record<string, unknown>} opts
 */
function sectionsFromCommandOptions(opts) {
  return Object.fromEntries(
    SECTION_FLAGS.map(({ option, section }) => [section, !opts[option]]),
  );
}

/**
 * @param {import('./types/index.d.ts').PicklejarSession} session
 */
function printSelectableActions(session) {
  const rows = listSelectableActions(session);
  if (!rows.length) {
    console.log('No recorded actions.');
    return;
  }
  console.log('Selectable actions (1-based indexes):');
  for (const row of rows) {
    console.log(
      `${row.index}. [${row.toolName}] ${new Date(row.timestamp).toISOString()} ${row.summary} status=${row.curationStatus} include=${row.includeInBrainDump ? 'yes' : 'no'}`,
    );
  }
}

/**
 * @param {import('./types/index.d.ts').PicklejarSession} session
 */
function printActionRows(session) {
  const rows = listSelectableActions(session);
  if (!rows.length) {
    console.log('No recorded actions.');
    return;
  }
  for (const row of rows) {
    console.log([
      row.index,
      new Date(row.timestamp).toISOString(),
      row.toolName,
      row.curationStatus,
      row.includeInBrainDump ? 'yes' : 'no',
      row.summary,
      row.curationNote || '',
    ].join('\t'));
  }
}

/**
 * @param {ReturnType<typeof listSelectableActions>} rows
 * @param {Set<number>} selected
 * @param {number} cursor
 */
function renderActionSelector(rows, selected, cursor) {
  const lines = [
    'Select actions to exclude from the generated summary.',
    'Keys: up/down move, space toggle, a all, n none, enter confirm, q cancel.',
    '',
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const pointer = i === cursor ? '>' : ' ';
    const mark = selected.has(row.index) ? '[x]' : '[ ]';
    lines.push(
      `${pointer} ${mark} ${row.index}. [${row.toolName}] ${new Date(row.timestamp).toISOString()} ${row.summary}`,
    );
  }
  return lines.join('\n');
}

/**
 * @param {import('./types/index.d.ts').PicklejarSession} session
 */
async function promptForExcludedActions(session) {
  const rows = listSelectableActions(session);
  if (!rows.length) {
    console.log('No recorded actions.');
    return [];
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    printSelectableActions(session);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question('Exclude action indexes (comma-separated, blank for none): ');
      return parseActionIndexes(answer);
    } finally {
      rl.close();
    }
  }

  const selected = new Set();
  let cursor = 0;
  const stdin = process.stdin;
  const stdout = process.stdout;

  return await new Promise((resolve) => {
    const redraw = () => {
      readlineUi.cursorTo(stdout, 0, 0);
      readlineUi.clearScreenDown(stdout);
      stdout.write(renderActionSelector(rows, selected, cursor));
    };

    const cleanup = () => {
      stdin.off('data', onData);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdout.write('\x1b[?25h');
      stdout.write('\n');
      stdin.pause();
    };

    const finish = () => {
      cleanup();
      resolve([...selected].sort((a, b) => a - b));
    };

    const toggleCurrent = () => {
      const current = rows[cursor];
      if (!current) return;
      if (selected.has(current.index)) selected.delete(current.index);
      else selected.add(current.index);
    };

    const onData = (chunk) => {
      const key = String(chunk);
      if (key === '\u0003') {
        cleanup();
        process.exit(130);
      }
      if (key === 'q' || key === '\r' || key === '\n') {
        finish();
        return;
      }
      if (key === ' ') {
        toggleCurrent();
        redraw();
        return;
      }
      if (key === 'a') {
        for (const row of rows) selected.add(row.index);
        redraw();
        return;
      }
      if (key === 'n') {
        selected.clear();
        redraw();
        return;
      }
      if (key === '\u001b[A' || key === 'k') {
        cursor = cursor > 0 ? cursor - 1 : rows.length - 1;
        redraw();
        return;
      }
      if (key === '\u001b[B' || key === 'j') {
        cursor = cursor < rows.length - 1 ? cursor + 1 : 0;
        redraw();
      }
    };

    stdout.write('\x1b[?25l');
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    redraw();
  });
}

/**
 * @param {{ estimatedTokens: number, maxTokens: number, omittedSections: string[] }} info
 */
function warnOnTruncate({ estimatedTokens, maxTokens, omittedSections }) {
  console.warn(
    `Warning: brain dump exceeded token budget (estimated ${estimatedTokens} tokens, limit ${maxTokens}).` +
    ` The following sections were trimmed: ${omittedSections.join(', ') || 'history/files'}.` +
    ` Increase maxTokens in .picklejar/config.json to retain full context.`,
  );
}

/**
 * @param {import('./types/index.d.ts').PicklejarSession} session
 * @param {Record<string, unknown>} opts
 */
async function resolveBrainDumpOptions(session, opts) {
  const cliExcluded = parseActionIndexes(typeof opts.excludeActions === 'string' ? opts.excludeActions : '');
  const interactiveExcluded = opts.interactiveActions ? await promptForExcludedActions(session) : [];
  const excludeActionIndexes = [...new Set([...cliExcluded, ...interactiveExcluded])].sort((a, b) => a - b);
  const curationProfile = normalizeCurationProfile(typeof opts.profile === 'string' ? opts.profile : '');
  if (typeof opts.profile === 'string' && !curationProfile) {
    throw new Error(`Invalid profile. Use one of: ${CURATION_PROFILES.join(', ')}`);
  }
  return {
    sections: {
      ...sectionsFromCommandOptions(opts),
      discardedPaths: Boolean(opts.withDiscardedPaths) || curationProfile === 'audit',
    },
    excludeActionIndexes,
    ignoreCuration: Boolean(opts.ignoreCuration),
    curationProfile: curationProfile ?? 'balanced',
  };
}

/**
 * @param {Command} cmd
 */
function addBrainDumpFilterOptions(cmd) {
  return cmd
    .option('--without-goal', 'exclude original user intent from the generated summary')
    .option('--without-next-action', 'exclude next planned action from the generated summary')
    .option('--without-error', 'exclude interruption reason from the generated summary')
    .option('--without-progress', 'exclude progress/task tree from the generated summary')
    .option('--without-decisions', 'exclude architecture decisions from the generated summary')
    .option('--without-active-files', 'exclude active file snapshots from the generated summary')
    .option('--without-recent-actions', 'exclude RECENT TRUSTED ACTIONS section from the generated summary')
    .option('--without-history', 'exclude TRUSTED HISTORY section from the generated summary')
    .option('--without-instructions', 'exclude resume instruction text from the generated summary')
    .option('--exclude-actions <indexes>', 'comma-separated 1-based action indexes to exclude from actions/history')
    .option('--interactive-actions', 'interactively choose action indexes to exclude from actions/history using keyboard controls')
    .option('--ignore-curation', 'ignore persisted curation metadata and include all stored actions by default')
    .option('--profile <name>', `curation profile: ${CURATION_PROFILES.join(', ')}`)
    .option('--with-discarded-paths', 'include a compact DISCARDED PATHS section in the generated summary')
    .option('--list-actions', 'print selectable action indexes and exit');
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

const actionsCmd = program
  .command('actions')
  .description('List recorded actions for a session')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .option('--json', 'output as JSON');

actionsCmd.action(async (id, dir) => {
  const projectDir = path.resolve(dir);
  const loaded = await loadSnapshot(projectDir, id);
  if (!loaded) {
    console.error('Session not found');
    process.exitCode = 1;
    return;
  }
  if (actionsCmd.opts().json) {
    console.log(JSON.stringify(listSelectableActions(loaded.session), null, 2));
    return;
  }
  printActionRows(loaded.session);
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
  .description('List sessions (use --sections for per-snapshot rows)')
  .argument('[dir]', 'project directory', process.cwd())
  .option('--verbose', 'show session details (files, next action, error)')
  .option('--sections', 'list each snapshot row with detected sections (legacy)')
  .option('--json', 'output listSessions() as JSON')
  .action(async (dir, opts) => {
    const projectDir = path.resolve(dir);
    if (opts.json) {
      const sessions = await listSessions(projectDir);
      console.log(JSON.stringify(sessions, null, 2));
      return;
    }
    if (opts.sections) {
      await listSnapshotsLegacy(projectDir, opts);
      return;
    }
    await printSessionList(projectDir, Boolean(opts.verbose));
  });

const inspectCmd = program
  .command('inspect')
  .description('Print session JSON (pretty)')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .option('--json', 'output deserialized session as JSON', true);

inspectCmd.action(async (id, dir) => {
  const projectDir = path.resolve(dir);
  const loaded = await loadSnapshot(projectDir, id);
  if (!loaded) {
    console.error('Session not found');
    process.exitCode = 1;
    return;
  }
  const useJson = inspectCmd.opts().json !== false;
  console.log(JSON.stringify(loaded.session, null, useJson ? 2 : undefined));
});

const exportCmd = addBrainDumpFilterOptions(program
  .command('export')
  .description('Write brain dump markdown for a session')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .option('-o, --out <file>', 'output .md path (default: .picklejar/export-<id>.md)'));

exportCmd.action(async (id, dir) => {
  try {
    const projectDir = path.resolve(dir);
    const opts = exportCmd.opts();
    const outOpt = opts.out;
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
    if (opts.listActions) {
      printSelectableActions(loaded.session);
      return;
    }
    const cfg = await loadConfig(projectDir);
    const dumpOptions = await resolveBrainDumpOptions(loaded.session, opts);
    const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens, ...dumpOptions, onTruncate: warnOnTruncate });
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, md, 'utf8');
    console.log(`Wrote ${outPath}`);
  } catch (e) {
    console.error(/** @type {Error} */ (e).message || e);
    process.exitCode = 1;
  }
});

const resumeCmd = addBrainDumpFilterOptions(program
  .command('resume')
  .description('Prepare session resume: write brain dump and set force-resume flag')
  .option('--id <id>', 'session id (default: latest)')
  .argument('[id]', 'session id (positional)')
  .argument('[dir]', 'project directory', process.cwd()));

resumeCmd.action(async (idArg, dir) => {
  try {
    const projectDir = path.resolve(dir);
    const opts = resumeCmd.opts();
    let sessionId = idArg || opts.id;
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
    if (opts.listActions) {
      printSelectableActions(loaded.session);
      return;
    }
    const cfg = await loadConfig(projectDir);
    const dumpOptions = await resolveBrainDumpOptions(loaded.session, opts);
    const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens, ...dumpOptions, onTruncate: warnOnTruncate });

    await fs.mkdir(picklejarRoot(projectDir), { recursive: true });
    await fs.writeFile(resumeContextPath(projectDir), md, 'utf8');
    await fs.writeFile(
      forceResumePath(projectDir),
      JSON.stringify({ sessionId, at: Date.now() }, null, 2),
      'utf8',
    );
    console.log(`Resume prepared for session ${sessionId}`);
    console.log(`Run: picklejar start <agent>   (see: picklejar capabilities)`);
  } catch (e) {
    console.error(/** @type {Error} */ (e).message || e);
    process.exitCode = 1;
  }
});

const openCmd = addBrainDumpFilterOptions(program
  .command('open')
  .description('Prepare resume context and launch a target agent in one step')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .requiredOption('--agent <agent>', `agent: ${AGENT_IDS.join(', ')}`));

openCmd.action(async (id, dir) => {
  try {
    const projectDir = path.resolve(dir);
    const opts = openCmd.opts();
    const agent = opts.agent;
    if (!AGENT_IDS.includes(agent)) {
      console.error(`Unknown agent '${agent}'. Run: picklejar capabilities`);
      process.exitCode = 1;
      return;
    }
    const loaded = await loadSnapshot(projectDir, id);
    if (!loaded) {
      console.error('Session not found');
      process.exitCode = 1;
      return;
    }
    if (opts.listActions) {
      printSelectableActions(loaded.session);
      return;
    }
    const cfg = await loadConfig(projectDir);
    const brainDumpOpts = await resolveBrainDumpOptions(loaded.session, opts);
    await openSessionInAgent({
      projectDir,
      sessionId: id,
      agent,
      maxTokens: cfg.maxTokens,
      brainDumpOpts,
      session: loaded.session,
      onTruncate: warnOnTruncate,
      onInjected: (injected) => {
        if (injected) {
          console.log('Resume context injected for', agent);
        }
      },
    });
  } catch (e) {
    console.error(/** @type {Error} */ (e).message || e);
    process.exitCode = 1;
  }
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
    await spawnAgent(agent, projectDir);
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

registerExploreCommand(program);
registerSummaryCommand(program);

program.parseAsync(process.argv);
