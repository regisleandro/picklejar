/**
 * Normalize PostToolUse-style payloads from Claude Code, Cursor, Cline, Copilot, etc.
 * @param {Record<string, unknown>} raw
 * @returns {{ sessionId: string, toolName: string, toolInput: Record<string, unknown>, toolResponse: string, transcriptPath?: string }}
 */
export function normalizePostToolUsePayload(raw) {
  const any = /** @type {Record<string, any>} */ (raw ?? {});

  // Cline: nested postToolUse
  const ptu = any.postToolUse;
  if (ptu && typeof ptu === 'object') {
    const tool = String(ptu.tool ?? 'unknown');
    const params =
      typeof ptu.parameters === 'object' && ptu.parameters != null ? { ...ptu.parameters } : {};
    let out = '';
    if (ptu.result != null) {
      out = typeof ptu.result === 'string' ? ptu.result : JSON.stringify(ptu.result);
    }
    return {
      sessionId: String(any.taskId ?? any.session_id ?? any.sessionId ?? 'unknown'),
      toolName: tool,
      toolInput: params,
      toolResponse: out,
      transcriptPath:
        typeof any.transcript_path === 'string'
          ? any.transcript_path
          : typeof any.transcriptPath === 'string'
            ? any.transcriptPath
            : undefined,
    };
  }

  // Copilot-style preToolUse-only (no output yet)
  const pre = any.preToolUse;
  if (pre && typeof pre === 'object' && !any.tool_name && !any.toolName) {
    const tool = String(pre.tool ?? 'unknown');
    const params =
      typeof pre.parameters === 'object' && pre.parameters != null ? { ...pre.parameters } : {};
    return {
      sessionId: String(
        any.session_id ?? any.sessionId ?? any.conversation_id ?? any.conversationId ?? 'unknown',
      ),
      toolName: tool,
      toolInput: params,
      toolResponse: '',
      transcriptPath:
        typeof any.transcript_path === 'string'
          ? any.transcript_path
          : typeof any.transcriptPath === 'string'
            ? any.transcriptPath
            : undefined,
    };
  }

  const sessionId = String(
    any.session_id ??
      any.sessionId ??
      any.conversation_id ??
      any.conversationId ??
      any.taskId ??
      'unknown',
  );
  const toolName = String(any.tool_name ?? any.toolName ?? 'unknown');
  const toolInput =
    (any.tool_input ?? any.toolInput) != null && typeof any.tool_input === 'object'
      ? { .../** @type {object} */ (any.tool_input) }
      : (any.tool_input ?? any.toolInput) != null && typeof any.toolInput === 'object'
        ? { .../** @type {object} */ (any.toolInput) }
        : {};

  const rawResponse =
    any.tool_response ??
    any.toolResponse ??
    any.tool_output ??
    any.toolOutput ??
    any.output ??
    any.result ??
    '';
  const toolResponse =
    typeof rawResponse === 'string' ? rawResponse : JSON.stringify(rawResponse);

  const transcriptPath =
    typeof any.transcript_path === 'string'
      ? any.transcript_path
      : typeof any.transcriptPath === 'string'
        ? any.transcriptPath
        : undefined;

  return { sessionId, toolName, toolInput, toolResponse, transcriptPath };
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {string}
 */
export function resolveSessionIdFromPayload(raw) {
  const any = /** @type {Record<string, any>} */ (raw ?? {});
  return String(
    any.session_id ??
      any.sessionId ??
      any.conversation_id ??
      any.conversationId ??
      any.taskId ??
      '',
  );
}
