/**
 * Best-effort agent origin detection for hook payloads.
 *
 * Preference order:
 * 1. Payload shape unique to an integration (authoritative — emitted by the
 *    actual caller, so it cannot be stale the way a baked-in env override can
 *    be when one IDE inherits another IDE's hook file; e.g. Cursor fires
 *    `.claude/settings.json` hooks with a Cursor-style payload).
 * 2. Explicit override via PICKLEJAR_AGENT_ORIGIN.
 * 3. Hook environment heuristics.
 *
 * @param {Record<string, unknown>} [payload]
 * @returns {string | undefined}
 */
export function detectAgentOrigin(payload = {}) {
  const any = /** @type {Record<string, any>} */ (payload ?? {});

  if (any.cursor_version != null || any.cursorVersion != null) {
    return 'cursor';
  }

  if (
    any.hookName === 'TaskStart' ||
    any.hookName === 'TaskResume' ||
    any.taskStart ||
    any.taskResume ||
    any.postToolUse
  ) {
    return 'cline';
  }

  const explicit = normalizeAgentOrigin(process.env.PICKLEJAR_AGENT_ORIGIN);
  if (explicit) return explicit;

  if (process.env.CURSOR_PROJECT_DIR || process.env.CURSOR_TRANSCRIPT_PATH) {
    return 'cursor';
  }

  if (process.env.CLAUDE_PROJECT_DIR) {
    return 'claude';
  }

  if (
    any.preToolUse ||
    any.conversation_id != null ||
    any.conversationId != null
  ) {
    return 'copilot';
  }

  return undefined;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeAgentOrigin(value) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized || undefined;
}
