import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSnapshot } from '../src/core/snapshot.js';

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

describe('e2e', () => {
  it('init continue merges .continue/settings.json with picklejar run-hook', async () => {
    const { code, err } = await runCli(['init', 'continue', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const settingsPath = path.join(proj, '.continue', 'settings.json');
    const raw = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(JSON.stringify(raw)).toContain('.picklejar/hooks/run-hook.js');
    expect(raw.hooks.PostToolUse).toBeDefined();
  });

  it('init cline writes hook scripts under .clinerules/hooks', async () => {
    const { code, err } = await runCli(['init', 'cline', proj], process.cwd());
    expect(code).toBe(0);
    expect(err).toBe('');
    const postTool = path.join(proj, '.clinerules', 'hooks', 'PostToolUse');
    const content = await fs.readFile(postTool, 'utf8');
    expect(content).toContain('post-tool-use');
  });

  it('capabilities prints JSON', async () => {
    const { code, out } = await runCli(['capabilities', 'claude'], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('"hooks"');
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

  it('list keeps the default snapshot-only output', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'list-default',
        tool_name: 'Read',
        tool_input: { file_path: 'src/default.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(['list', proj], process.cwd());
    expect(code).toBe(0);
    const line = out.trim().split('\n').find((row) => row.startsWith('list-default\t'));
    expect(line).toBeTruthy();
    expect(line.split('\t')).toHaveLength(3);
    expect(line).toContain('.bin');
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
    const line = out.trim().split('\n').filter((row) => row.startsWith('list-verbose\t')).at(-1);
    expect(line).toBeTruthy();
    const cols = line.split('\t');
    expect(cols).toHaveLength(5);
    expect(cols[2]).toBe('Ship list titles');
    expect(cols[3]).toBe('1');
    expect(cols[4]).toBe('no');
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
    expect(cols[2]).toBe('src/sections.ts');
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

  it('curate exclude persists and resume respects it by default', async () => {
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

    const excluded = await runCli(['curate', 'exclude', 'curate-resume', '2', proj], process.cwd());
    expect(excluded.code).toBe(0);

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
    const excluded = await runCli(['curate', 'exclude', 'curate-ignore', '1', proj], process.cwd());
    expect(excluded.code).toBe(0);

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
    const tagged = await runCli(['curate', 'tag', 'actions-cli', '1', 'confirmed', proj], process.cwd());
    expect(tagged.code).toBe(0);
    const noted = await runCli(['curate', 'note', 'actions-cli', '1', 'validated', proj], process.cwd());
    expect(noted.code).toBe(0);

    const { code, out } = await runCli(['actions', 'actions-cli', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('confirmed');
    expect(out).toContain('validated');
    expect(out).toContain('yes');
  });

  it('curate suggest reports likely inconsistent actions', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'suggest-cli',
        tool_name: 'Bash',
        tool_input: { command: 'cat missing.txt' },
        tool_response: 'cat: missing.txt: No such file or directory',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code, out } = await runCli(['curate', 'suggest', 'suggest-cli', proj], process.cwd());
    expect(code).toBe(0);
    expect(out).toContain('inconsistent');
    expect(out).toContain('failure keywords detected');
  });

  it('curate review supports non-tty fallback prompts', async () => {
    await runHook(
      'post-tool-use',
      {
        session_id: 'review-cli',
        tool_name: 'Read',
        tool_input: { file_path: 'src/review.ts' },
        tool_response: 'ok',
      },
      { CLAUDE_PROJECT_DIR: proj },
    );
    const { code } = await runCli(['curate', 'review', 'review-cli', proj], process.cwd(), 'confirmed 1\n');
    expect(code).toBe(0);
    const { out } = await runCli(['actions', 'review-cli', proj], process.cwd());
    expect(out).toContain('confirmed');
  });
});
