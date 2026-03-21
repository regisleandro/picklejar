import { describe, it, expect } from 'vitest';
import { normalizePostToolUsePayload, resolveSessionIdFromPayload } from '../src/core/normalize-payload.js';

describe('normalizePostToolUsePayload', () => {
  it('maps Claude-style fields', () => {
    const n = normalizePostToolUsePayload({
      session_id: 's1',
      tool_name: 'Read',
      tool_input: { file_path: 'a.ts' },
      tool_response: 'ok',
    });
    expect(n.sessionId).toBe('s1');
    expect(n.toolName).toBe('Read');
    expect(n.toolInput.file_path).toBe('a.ts');
    expect(n.toolResponse).toBe('ok');
  });

  it('maps Cursor tool_output', () => {
    const n = normalizePostToolUsePayload({
      conversation_id: 'c1',
      tool_name: 'Shell',
      tool_input: { command: 'ls' },
      tool_output: '{"exitCode":0}',
    });
    expect(n.sessionId).toBe('c1');
    expect(n.toolName).toBe('Shell');
    expect(n.toolResponse).toContain('exitCode');
  });

  it('maps Cline postToolUse', () => {
    const n = normalizePostToolUsePayload({
      taskId: 't1',
      postToolUse: {
        tool: 'read_file',
        parameters: { path: 'x.ts' },
        result: 'hello',
        success: true,
        durationMs: 10,
      },
    });
    expect(n.sessionId).toBe('t1');
    expect(n.toolName).toBe('read_file');
    expect(n.toolInput.path).toBe('x.ts');
    expect(n.toolResponse).toBe('hello');
  });
});

describe('resolveSessionIdFromPayload', () => {
  it('reads conversation_id for Cursor-style payloads', () => {
    expect(resolveSessionIdFromPayload({ conversation_id: 'x' })).toBe('x');
  });
});
