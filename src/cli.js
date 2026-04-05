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
  CURATION_STATUSES,
  EXCLUDED_CURATION_STATUSES,
  mutateActionsByIndexes,
  normalizeCurationStatus,
} from './core/curation.js';
import { picklejarRoot, forceResumePath, resumeContextPath, snapshotsDir } from './core/paths.js';
import { summarizeSessionForList } from './core/list-summary.js';
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
 * @param {import('./types/index.d.ts').PicklejarSession} session
 * @param {Record<string, unknown>} opts
 */
async function resolveBrainDumpOptions(session, opts) {
  const cliExcluded = parseActionIndexes(typeof opts.excludeActions === 'string' ? opts.excludeActions : '');
  const interactiveExcluded = opts.interactiveActions ? await promptForExcludedActions(session) : [];
  const excludeActionIndexes = [...new Set([...cliExcluded, ...interactiveExcluded])].sort((a, b) => a - b);
  return {
    sections: sectionsFromCommandOptions(opts),
    excludeActionIndexes,
    ignoreCuration: Boolean(opts.ignoreCuration),
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
    .option('--without-recent-actions', 'exclude RECENT ACTIONS section from the generated summary')
    .option('--without-history', 'exclude SUMMARIZED HISTORY section from the generated summary')
    .option('--without-instructions', 'exclude resume instruction text from the generated summary')
    .option('--exclude-actions <indexes>', 'comma-separated 1-based action indexes to exclude from actions/history')
    .option('--interactive-actions', 'interactively choose action indexes to exclude from actions/history using keyboard controls')
    .option('--ignore-curation', 'ignore persisted curation metadata and include all stored actions by default')
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

program
  .command('actions')
  .description('List recorded actions for a session')
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
    printActionRows(loaded.session);
  });

const curate = program
  .command('curate')
  .description('Persist curation metadata on recorded actions');

/**
 * @param {'exclude' | 'include' | 'tag' | 'note' | 'reset'} operation
 * @param {(action: import('./types/index.d.ts').ToolAction, payload?: string) => void} updater
 */
function registerCurateCommand(operation, updater) {
  const cmd = curate
    .command(operation)
    .argument('<id>', 'session id')
    .argument('<indexes>', 'comma-separated 1-based action indexes');

  if (operation === 'tag') {
    cmd.argument('<value>', 'curation tag');
  } else if (operation === 'note') {
    cmd.argument('<value>', 'note text');
  }

  cmd.argument('[dir]', 'project directory', process.cwd());

  cmd.action(async (id, indexesRaw, valueOrDir, maybeDir) => {
    const requiresValue = operation === 'tag' || operation === 'note';
    const value = requiresValue ? valueOrDir : undefined;
    const projectDir = path.resolve(requiresValue ? (maybeDir || process.cwd()) : (valueOrDir || process.cwd()));
    const indexes = parseActionIndexes(indexesRaw);

    if (!indexes.length) {
      console.error('No valid action indexes supplied');
      process.exitCode = 1;
      return;
    }

    const loaded = await loadSnapshot(projectDir, id);
    if (!loaded) {
      console.error('Session not found');
      process.exitCode = 1;
      return;
    }

    if (operation === 'tag') {
      const normalized = normalizeCurationStatus(value);
      if (!normalized || normalized === 'default') {
        console.error(`Invalid curation tag. Use one of: ${CURATION_STATUSES.filter((status) => status !== 'default').join(', ')}`);
        process.exitCode = 1;
        return;
      }
    }

    if (operation === 'note' && !String(value ?? '').trim()) {
      console.error('Note text is required');
      process.exitCode = 1;
      return;
    }

    const changed = mutateActionsByIndexes(loaded.session, indexes, (action) => {
      updater(action, value);
      action.curatedAt = Date.now();
      action.curatedBy = 'cli';
    });

    if (changed === 0) {
      console.error('No matching action indexes found');
      process.exitCode = 1;
      return;
    }

    await saveSnapshot(loaded.session);
    console.log(`${operation} updated ${changed} action(s) on session ${loaded.session.sessionId}`);
  });
}

registerCurateCommand('exclude', (action) => {
  action.includeInBrainDump = false;
  if (!EXCLUDED_CURATION_STATUSES.has(action.curationStatus ?? 'default')) {
    action.curationStatus = 'discarded';
  }
});

registerCurateCommand('include', (action) => {
  action.includeInBrainDump = true;
  if (EXCLUDED_CURATION_STATUSES.has(action.curationStatus ?? 'default')) {
    action.curationStatus = 'default';
  }
});

registerCurateCommand('tag', (action, value) => {
  const normalized = normalizeCurationStatus(value) ?? 'default';
  action.curationStatus = normalized;
  if (EXCLUDED_CURATION_STATUSES.has(normalized)) {
    action.includeInBrainDump = false;
  } else if (action.includeInBrainDump === false) {
    action.includeInBrainDump = true;
  }
});

registerCurateCommand('note', (action, value) => {
  action.curationNote = String(value).trim();
});

registerCurateCommand('reset', (action) => {
  delete action.includeInBrainDump;
  delete action.curationStatus;
  delete action.curationNote;
  delete action.curatedAt;
  delete action.curatedBy;
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
  .option('--verbose', 'show derived session title, actions count, and ended status')
  .option('--sections', 'show detected content sections present in each snapshot')
  .action(async (dir, opts) => {
    const projectDir = path.resolve(dir);
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

const exportCmd = addBrainDumpFilterOptions(program
  .command('export')
  .description('Write brain dump markdown for a session')
  .argument('<id>', 'session id')
  .argument('[dir]', 'project directory', process.cwd())
  .option('-o, --out <file>', 'output .md path (default: .picklejar/export-<id>.md)'));

exportCmd.action(async (id, dir) => {
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
  const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens, ...dumpOptions });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf8');
  console.log(`Wrote ${outPath}`);
});

const resumeCmd = addBrainDumpFilterOptions(program
  .command('resume')
  .description('Prepare session resume: write brain dump and set force-resume flag')
  .option('--id <id>', 'session id (default: latest)')
  .argument('[id]', 'session id (positional)')
  .argument('[dir]', 'project directory', process.cwd()));

resumeCmd.action(async (idArg, dir) => {
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
  const md = compileBrainDump(loaded.session, { maxTokens: cfg.maxTokens, ...dumpOptions });

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
