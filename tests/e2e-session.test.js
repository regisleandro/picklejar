import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot, saveSnapshot } from '../src/core/snapshot.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'src', 'cli.js');

function runCli(args, cwd, stdinText = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    if (stdinText) child.stdin.write(stdinText);
    child.stdin.end();
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function runHook(name, json, env) {
  const script = path.join(root, 'src', 'hooks', `${name}.js`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(JSON.stringify(json));
    child.stdin.end();
  });
}

let proj;

beforeEach(async () => {
  // Keep under repo root so environments that block `.cursor` in system temp still pass CI/sandbox.
  proj = await fs.mkdtemp(path.join(root, '.picklejar-e2e-'));
});

afterEach(async () => {
  await fs.rm(proj, { recursive: true, force: true });
});

async function updateLatestSession(sessionId, updater) {
  const loaded = await loadSnapshot(proj, sessionId);
  expect(loaded).toBeTruthy();
  updater(loaded.session);
  await saveSnapshot(loaded.session);
}

describe('e2e', () => {
  it('post-tool-use persists detected agent origin on new sessions', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'agent-origin-claude',
        tool_name: 'Read',
        tool_input: { file_path: 'src/origin.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const snap = await loadSnapshot(proj, 'agent-origin-claude');
    expect(snap?.session.agentOrigin).toBe('claude');
  });

  it('session-start honors explicit agent origin override', async () => {
    const { code } = await runHook(
      'session-start',
      { source: 'startup', session_id: 'agent-origin-continue' },
      {
        CLAUDE_PROJECT_DIR: proj,
        PICKLEJAR_AGENT_ORIGIN: 'continue',
      },
    );
    expect(code).toBe(0);
    const snap = await loadSnapshot(proj, 'agent-origin-continue');
    expect(snap?.session.agentOrigin).toBe('continue');
  });

  it('init continue merges .continue/settings.json with picklejar run-hook', async () => {
    const { code, err } = await runCli(['init', 'continue', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const settingsPath = path.join(proj, '.continue', 'settings.json');
    const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(JSON.stringify(raw)).toContain('.picklejar/hooks/run-hook.js');
    expect(JSON.stringify(raw)).toContain('PICKLEJAR_AGENT_ORIGIN');
    expect(raw.hooks.PostToolUse).toBeDefined();
  });

  it('init cline writes hook scripts under .clinerules/hooks', async () => {
    const { code, err } = await runCli(['init', 'cline', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const postTool = path.join(proj, '.clinerules', 'hooks', 'PostToolUse');
    const content = await fs.readFile(postTool, 'utf8');
    expect(content).toContain('PICKLEJAR_AGENT_ORIGIN="cline"');
    expect(content).toContain('post-tool-use');
  });

  it('capabilities prints JSON', async () => {
    const { code, out } = await runCli(['capabilities', 'claude'], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('"hooks"');
  });

  it('help no longer exposes curate', async () => {
    const { code, out } = await runCli(['--help'], process.cwd());
    expect(code).toBe(0);
    expect(out).not.toContain('curate');
    expect(out).toContain('list');
    expect(out).toContain('resume');
  });

  it('prints help successfully when called without arguments', async () => {
    const { code, out, err } = await runCli([], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain('Usage: picklejar');
    expect(out).toContain('Commands:');
  });

  it('init creates run-hook and settings with both resume and startup matchers', async () => {
    const { code, err } = await runCli(['init', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const rh = path.join(proj, '.picklejar', 'hooks', 'run-hook.js');
    await fs.access(rh);
    const settings = JSON.parse(await fs.readFile(path.join(proj, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PostToolUse).toBeDefined();
    const sessionStartMatchers = settings.hooks.SessionStart.map((e) => e.matcher);
    expect(sessionStartMatchers).toContain('resume');
    expect(sessionStartMatchers).toContain('startup');
  });

  it('init upgrades existing hooks adding startup matcher if missing', async () => {
    // Simulate old installation with only 'resume' matcher
    const settingsPath = path.join(proj, '.claude', 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const oldSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: 'resume',
            hooks: [{ type: 'command', command: `node ${proj}/.picklejar/hooks/run-hook.js session-start` }],
          },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(oldSettings, null, 2), 'utf8');
    const { code, out } = await runCli(['init', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('missing SessionStart matchers added');
    const updated = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    const matchers = updated.hooks.SessionStart.map((e) => e.matcher);
    expect(matchers).toContain('startup');
    expect(matchers).toContain('compact');
  });

  it('goal command sets session goal', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'goal-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'x.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(['goal', 'Ship JWT auth', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('Ship JWT auth');
    const snap = await loadSnapshot(proj, 'goal-cli');
    expect(snap?.session.goal).toBe('Ship JWT auth');
  });

  it('decide command appends to decisions', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'decide-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'y.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(
      ['decide', 'PostgreSQL', 'relational data', proj],
      process.cwd(),
    );
    expect(code).toBe(0);
    expect(out).toContain('PostgreSQL');
    const snap = await loadSnapshot(proj, 'decide-cli');
    expect(snap?.session.decisions).toHaveLength(1);
    expect(snap?.session.decisions[0].description).toBe('PostgreSQL');
    expect(snap?.session.decisions[0].reasoning).toBe('relational data');
  });

  it('resume flag + session-start loads brain dump', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'e2e1',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
        tool_response: 'hi\n'.repeat(600),
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code } = await runCli(['resume', 'e2e1', proj], process.cwd());
    expect(code).toBe(0);

    // Brain dump written to resume-context.md (agent-agnostic)
    const ctxPath = path.join(proj, '.picklejar', 'resume-context.md');
    const ctxContent = await fs.readFile(ctxPath, 'utf8');
    expect(ctxContent).toContain('[PICKLEJAR RESUME]');

    // startup source: no additionalContext (injected via CLAUDE.md by `picklejar start`)
    const { code: c2, stdout } = await runHook(
      'session-start',
      { source: 'startup', session_id: 'e2e1' },
      { CLAUDE_PROJECT_DIR: proj },
    );
    expect(c2).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.additionalContext).toBeUndefined();

    const snap = await loadSnapshot(proj, 'e2e1');
    expect(snap?.session.actions[0].output.split('\n').length).toBeLessThan(600);
  });

  it('list shows full session id and wider titles by default', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'list-default-session-id',
        tool_name: 'Read',
        tool_input: { file_path: 'src/default.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const longTitle = 'Session list title width validation for operations view';
    const { code: goalCode } = await runCli(['goal', longTitle, proj], process.cwd());
    expect(goalCode).toBe(0);
    const { code, out } = await runCli(['list', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('Sessions found');
    expect(out).toContain('SESSION ID');
    expect(out).toContain('list-default-session-id');
    expect(out).toContain(longTitle);
  });

  it('list --verbose shows derived title, action count, and ended status', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'list-verbose',
        tool_name: 'Read',
        tool_input: { file_path: 'src/verbose.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code: goalCode } = await runCli(['goal', 'Ship list titles', proj], process.cwd());
    expect(goalCode).toBe(0);

    const { code, out } = await runCli(['list', proj, '--verbose'], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('Ship list titles');
    expect(out).toContain('status: active');
    expect(out).toContain('1 actions');
  });

  it('list --sections shows detected sections and title fallback', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'list-sections',
        tool_name: 'Read',
        tool_input: { file_path: 'src/sections.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(['list', proj, '--verbose', '--sections'], process.cwd());
    expect(code).toBe(0);
    const line = out.trim().split('\n').filter((row) => row.startsWith('list-sections\t')).at(-1);
    expect(line).toBeTruthy();
    const cols = line.split('\t');
    expect(cols).toHaveLength(6);
    expect(cols[2]).toBe('Session list-sec');
    expect(cols[5]).toContain('[progress, active files, recent actions]');
  });

  it('export supports excluding sections and action indexes', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'export-filter',
        tool_name: 'Read',
        tool_input: { file_path: 'alpha.ts' },
        tool_response: 'alpha',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await runHook(
      'post-tool-use',
      {
        session_id: 'export-filter',
        tool_name: 'Edit',
        tool_input: { file_path: 'beta.ts', new_string: 'beta' },
        tool_response: 'beta',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const outFile = path.join(proj, 'filtered-export.md');
    const { code } = await runCli(
      ['export', 'export-filter', proj, '--without-active-files', '--exclude-actions', '2', '--out', outFile],
      process.cwd(),
    );
    expect(code).toBe(0);
    const content = await fs.readFile(outFile, 'utf8');
    expect(content).not.toContain('## ACTIVE FILES');
    expect(content).toContain('alpha.ts');
    expect(content).not.toContain('beta.ts');
  });

  it('resume supports interactive action exclusion', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'resume-filter',
        tool_name: 'Read',
        tool_input: { file_path: 'one.ts' },
        tool_response: 'one',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await runHook(
      'post-tool-use',
      {
        session_id: 'resume-filter',
        tool_name: 'Read',
        tool_input: { file_path: 'two.ts' },
        tool_response: 'two',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(
      ['resume', 'resume-filter', proj, '--interactive-actions'],
      process.cwd(),
      '2\n',
    );
    expect(code).toBe(0);
    expect(out).toContain('Selectable actions');
    const ctx = await fs.readFile(path.join(proj, '.picklejar', 'resume-context.md'), 'utf8');
    expect(ctx).toContain('- [Read] one.ts');
    expect(ctx).not.toContain('- [Read] two.ts');
  });

  it('resume respects persisted curation metadata by default', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'curate-resume',
        tool_name: 'Read',
        tool_input: { file_path: 'src/keep.ts' },
        tool_response: 'keep',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await runHook(
      'post-tool-use',
      {
        session_id: 'curate-resume',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/drop.ts' },
        tool_response: 'drop',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await updateLatestSession('curate-resume', (session) => {
      const action = session.actions?.[1];
      action.includeInBrainDump = false;
      action.curationStatus = 'discarded';
      action.curatedAt = Date.now();
      action.curatedBy = 'test';
    });

    const { code } = await runCli(['resume', 'curate-resume', proj], process.cwd());
    expect(code).toBe(0);
    const ctxPath = path.join(proj, '.picklejar', 'resume-context.md');
    const ctxContent = await fs.readFile(ctxPath, 'utf8');
    expect(ctxContent).toContain('src/keep.ts');
    expect(ctxContent).not.toContain('src/drop.ts');
  });

  it('resume can ignore persisted curation filters', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'curate-ignore',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/drop.ts' },
        tool_response: 'drop',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await updateLatestSession('curate-ignore', (session) => {
      const action = session.actions?.[0];
      action.includeInBrainDump = false;
      action.curationStatus = 'discarded';
      action.curatedAt = Date.now();
      action.curatedBy = 'test';
    });

    const { code } = await runCli(['resume', 'curate-ignore', proj, '--ignore-curation'], process.cwd());
    expect(code).toBe(0);
    const ctxPath = path.join(proj, '.picklejar', 'resume-context.md');
    const ctxContent = await fs.readFile(ctxPath, 'utf8');
    expect(ctxContent).toContain('src/drop.ts');
  });

  it('actions command prints persisted curation metadata', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'actions-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'src/a.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await updateLatestSession('actions-cli', (session) => {
      const action = session.actions?.[0];
      action.curationStatus = 'confirmed';
      action.includeInBrainDump = true;
      action.curationNote = 'validated';
      action.curatedAt = Date.now();
      action.curatedBy = 'test';
    });

    const { code, out } = await runCli(['actions', 'actions-cli', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('confirmed');
    expect(out).toContain('validated');
    expect(out).toContain('yes');
  });

  it('resume supports strict profile with confirmed actions only', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'profile-strict',
        tool_name: 'Read',
        tool_input: { file_path: 'src/confirmed.ts' },
        tool_response: 'confirmed',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await runHook(
      'post-tool-use',
      {
        session_id: 'profile-strict',
        tool_name: 'Read',
        tool_input: { file_path: 'src/default.ts' },
        tool_response: 'default',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await updateLatestSession('profile-strict', (session) => {
      const action = session.actions?.[0];
      action.curationStatus = 'confirmed';
      action.includeInBrainDump = true;
      action.curatedAt = Date.now();
      action.curatedBy = 'test';
    });
    const { code } = await runCli(['resume', 'profile-strict', proj, '--profile', 'strict'], process.cwd());
    expect(code).toBe(0);
    const ctx = await fs.readFile(path.join(proj, '.picklejar', 'resume-context.md'), 'utf8');
    expect(ctx).toContain('src/confirmed.ts');
    expect(ctx).not.toContain('src/default.ts');
  });

  it('export supports audit profile with discarded paths', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'profile-audit',
        tool_name: 'Read',
        tool_input: { file_path: 'src/audit.ts' },
        tool_response: 'audit',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    await updateLatestSession('profile-audit', (session) => {
      const action = session.actions?.[0];
      action.curationStatus = 'discarded';
      action.includeInBrainDump = false;
      action.curatedAt = Date.now();
      action.curatedBy = 'test';
    });
    const outFile = path.join(proj, 'audit.md');
    const { code } = await runCli(['export', 'profile-audit', proj, '--profile', 'audit', '-o', outFile], process.cwd());
    expect(code).toBe(0);
    const md = await fs.readFile(outFile, 'utf8');
    expect(md).toContain('src/audit.ts');
    expect(md).toContain('## DISCARDED PATHS');
  });

  it('export reports invalid profile cleanly', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'invalid-profile',
        tool_name: 'Read',
        tool_input: { file_path: 'src/a.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, err } = await runCli(['export', 'invalid-profile', proj, '--profile', 'nope'], process.cwd());
    expect(code).toBe(1);
    expect(err).toContain('Invalid profile');
    expect(err).not.toContain('file:///');
  });
});
