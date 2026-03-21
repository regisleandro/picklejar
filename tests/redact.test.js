import { describe, it, expect } from 'vitest';
import { redactWithPatterns } from '../src/core/redact.js';

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
