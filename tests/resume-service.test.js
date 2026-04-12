import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as registry from '../src/agents/registry.js';
import { createSession, addAction } from '../src/core/state.js';
import { saveSnapshot } from '../src/core/snapshot.js';
import { normalizeBrainDumpOptions } from '../src/core/compiler.js';
import {
  prepareResumeContext,
  buildHandoffDumpOptions,
  sectionsFromExcludeLabels,
  openSessionInAgent,
} from '../src/core/resume-service.js';
import { resumeContextPath, forceResumePath, picklejarRoot } from '../src/core/paths.js';

describe('resume-service', () => {
  /** @type {string} */
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-resume-'));
    vi.spyOn(registry, 'spawnAgent').mockImplementation(() => {});
    vi.spyOn(registry, 'injectResumeContext').mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('prepareResumeContext writes resume-context.md and force-resume.json', async () => {
    const s = createSession('rs1', tmpDir);
    s.goal = 'Test goal';
    await saveSnapshot(s);

    const opts = normalizeBrainDumpOptions({ curationProfile: 'balanced' });
    const { brainDump, sessionId } = await prepareResumeContext({
      projectDir: tmpDir,
      sessionId: 'rs1',
      maxTokens: 50_000,
      brainDumpOpts: opts,
    });

    expect(sessionId).toBe('rs1');
    expect(brainDump).toContain('[PICKLEJAR RESUME]');
    expect(brainDump).toContain('Test goal');

    const ctx = await fs.readFile(resumeContextPath(tmpDir), 'utf8');
    expect(ctx).toContain('Test goal');
    const force = JSON.parse(await fs.readFile(forceResumePath(tmpDir), 'utf8'));
    expect(force.sessionId).toBe('rs1');
  });

  it('exclude history omits TRUSTED HISTORY section', async () => {
    const s = createSession('rs2', tmpDir);
    for (let i = 0; i < 20; i += 1) {
      addAction(s, {
        id: String(i),
        timestamp: Date.now() + i,
        toolName: 'Read',
        input: { f: `f${i}.ts` },
        output: 'ok',
        relatedFiles: [`f${i}.ts`],
      });
    }
    await saveSnapshot(s);

    const handoff = buildHandoffDumpOptions({ profile: 'balanced', exclude: ['history'] });
    const { brainDump } = await prepareResumeContext({
      projectDir: tmpDir,
      sessionId: 'rs2',
      maxTokens: 50_000,
      brainDumpOpts: handoff,
    });

    expect(brainDump).not.toContain('## TRUSTED HISTORY');
    expect(brainDump).toContain('## RECENT TRUSTED ACTIONS');
  });

  it('strict profile excludes non-confirmed actions from dump', async () => {
    const s = createSession('rs3', tmpDir);
    addAction(s, {
      id: 'a',
      timestamp: Date.now(),
      toolName: 'Read',
      input: {},
      output: 'only-default',
      relatedFiles: ['only.ts'],
    });
    addAction(s, {
      id: 'b',
      timestamp: Date.now() + 1,
      toolName: 'Read',
      input: {},
      output: 'confirmed-one',
      relatedFiles: ['confirmed.ts'],
      curationStatus: 'confirmed',
      includeInBrainDump: true,
    });
    await saveSnapshot(s);

    const strict = normalizeBrainDumpOptions({ curationProfile: 'strict' });
    const { brainDump } = await prepareResumeContext({
      projectDir: tmpDir,
      sessionId: 'rs3',
      maxTokens: 50_000,
      brainDumpOpts: strict,
    });

    expect(brainDump).toContain('confirmed.ts');
    expect(brainDump).not.toContain('only-default');
  });

  it('sectionsFromExcludeLabels maps history and instructions', () => {
    const p = sectionsFromExcludeLabels(['history', 'instructions', 'discarded paths']);
    expect(p.summarizedHistory).toBe(false);
    expect(p.resumeInstructions).toBe(false);
    expect(p.discardedPaths).toBe(false);
  });

  it('injectResumeContext removes resume-context.md and force-resume.json after injection', async () => {
    const root = picklejarRoot(tmpDir);
    await fs.mkdir(root, { recursive: true });
    const brain = '# [PICKLEJAR RESUME] test\n> Session: inject-cleanup\n';
    await fs.writeFile(resumeContextPath(tmpDir), brain, 'utf8');
    await fs.writeFile(forceResumePath(tmpDir), JSON.stringify({ sessionId: 'inject-cleanup' }), 'utf8');

    vi.restoreAllMocks();
    const injected = await registry.injectResumeContext('claude', tmpDir);
    expect(injected).toBe(true);

    await expect(fs.access(resumeContextPath(tmpDir))).rejects.toThrow();
    await expect(fs.access(forceResumePath(tmpDir))).rejects.toThrow();

    // restore spy for other tests
    vi.spyOn(registry, 'spawnAgent').mockImplementation(() => {});
    vi.spyOn(registry, 'injectResumeContext').mockResolvedValue(true);
  });

  it('openSessionInAgent calls inject and spawn without subprocess CLI', async () => {
    const s = createSession('rs4', tmpDir);
    s.goal = 'Open test';
    await saveSnapshot(s);

    const opts = normalizeBrainDumpOptions({ curationProfile: 'balanced' });
    await openSessionInAgent({
      projectDir: tmpDir,
      sessionId: 'rs4',
      agent: 'claude',
      maxTokens: 50_000,
      brainDumpOpts: opts,
      session: s,
    });

    expect(registry.injectResumeContext).toHaveBeenCalledWith('claude', tmpDir);
    expect(registry.spawnAgent).toHaveBeenCalledWith('claude', tmpDir, { detach: false });
  });
});
