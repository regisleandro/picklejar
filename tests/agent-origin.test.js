import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectAgentOrigin } from '../src/core/agent-origin.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('detectAgentOrigin', () => {
  it('prefers explicit PICKLEJAR_AGENT_ORIGIN override', () => {
    vi.stubEnv('PICKLEJAR_AGENT_ORIGIN', 'continue');
    vi.stubEnv('CLAUDE_PROJECT_DIR', '/tmp/project');
    expect(detectAgentOrigin({})).toBe('continue');
  });

  it('detects cline from payload shape', () => {
    expect(detectAgentOrigin({ hookName: 'TaskStart' })).toBe('cline');
    expect(detectAgentOrigin({ postToolUse: { tool: 'Read' } })).toBe('cline');
  });

  it('detects copilot from payload shape', () => {
    expect(detectAgentOrigin({ conversation_id: 'abc' })).toBe('copilot');
    expect(detectAgentOrigin({ preToolUse: { tool: 'Read' } })).toBe('copilot');
  });

  it('detects cursor and claude from hook env', () => {
    vi.stubEnv('CURSOR_PROJECT_DIR', '/tmp/cursor-project');
    expect(detectAgentOrigin({})).toBe('cursor');

    vi.unstubAllEnvs();
    vi.stubEnv('CLAUDE_PROJECT_DIR', '/tmp/claude-project');
    expect(detectAgentOrigin({})).toBe('claude');
  });

  it('detects cursor even when payload contains conversation_id', () => {
    vi.stubEnv('CURSOR_PROJECT_DIR', '/tmp/cursor-project');
    expect(detectAgentOrigin({ conversation_id: 'abc', tool_name: 'Read' })).toBe('cursor');
  });

  it('detects cursor via CURSOR_TRANSCRIPT_PATH even when payload contains conversationId', () => {
    vi.stubEnv('CURSOR_TRANSCRIPT_PATH', '/tmp/cursor/transcript.jsonl');
    expect(detectAgentOrigin({ conversationId: 'abc', tool_name: 'Shell' })).toBe('cursor');
  });
});
