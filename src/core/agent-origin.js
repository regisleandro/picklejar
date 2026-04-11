/**
 * Best-effort agent origin detection for hook payloads.
 *
 * Preference order:
 * 1. Explicit override via PICKLEJAR_AGENT_ORIGIN
 * 2. Payload shape that is unique to an integration
 * 3. Hook environment heuristics
 *
 * @param {Record<string, unknown>} [payload]
 * @returns {string | undefined}
 */
export function detectAgentOrigin(payload = {}) {
  const explicit = normalizeAgentOrigin(process.env.PICKLEJAR_AGENT_ORIGIN);
  if (explicit) return explicit;

  const any = /** @type {Record<string, any>} */ (payload ?? {});

  if (
    any.hookName === 'TaskStart' ||
    any.hookName === 'TaskResume' ||
    any.taskStart ||
    any.taskResume ||
    any.postToolUse
  ) {
    return 'cline';
  }

  // Env-var checks come before payload-shape checks because Cursor payloads
  // also carry `conversation_id`, which would otherwise be misidentified as Copilot.
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
