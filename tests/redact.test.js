import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { redactWithPatterns } from '../src/core/redact.js';
import { loadConfig } from '../src/core/config.js';
import { picklejarRoot } from '../src/core/paths.js';

describe('redactWithPatterns', () => {
  it('replaces matches', () => {
    const out = redactWithPatterns('key sk-abc123', ['sk-[a-z0-9]+']);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('sk-abc');
  });

  it('ignores invalid regex sources', () => {
    expect(redactWithPatterns('ok', ['('])).toBe('ok');
  });
});

describe('loadConfig', () => {
  let tmpDir;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns defaults when config.json is absent', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-cfg-'));
    const cfg = await loadConfig(tmpDir);
    expect(cfg.maxTokens).toBe(30000);
    expect(cfg.redactPatterns.length).toBeGreaterThan(0);
  });

  it('warns to stderr and returns defaults when config.json is malformed JSON', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-cfg-'));
    await fs.mkdir(picklejarRoot(tmpDir), { recursive: true });
    await fs.writeFile(path.join(picklejarRoot(tmpDir), 'config.json'), '{ not valid json', 'utf8');

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cfg = await loadConfig(tmpDir);

    expect(cfg.maxTokens).toBe(30000);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Redaction patterns'));
  });

  it('applies custom maxTokens from valid config.json', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'picklejar-cfg-'));
    await fs.mkdir(picklejarRoot(tmpDir), { recursive: true });
    await fs.writeFile(
      path.join(picklejarRoot(tmpDir), 'config.json'),
      JSON.stringify({ maxTokens: 60000 }),
      'utf8',
    );
    const cfg = await loadConfig(tmpDir);
    expect(cfg.maxTokens).toBe(60000);
  });
});
