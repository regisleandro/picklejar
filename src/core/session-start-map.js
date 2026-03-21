import { getTranscriptPathFromEnv } from './env.js';

/**
 * Map Cline / Cursor / Claude SessionStart payloads to internal shape.
 * @param {Record<string, unknown>} payload
 */
export function mapSessionStartPayload(payload) {
  const any = /** @type {Record<string, any>} */ (payload ?? {});

  if (any.hookName === 'TaskStart' || any.taskStart) {
    return {
      source: 'startup',
      sessionId: String(any.taskId ?? ''),
      transcriptPath:
        typeof any.transcript_path === 'string'
          ? any.transcript_path
          : typeof any.transcriptPath === 'string'
            ? any.transcriptPath
            : getTranscriptPathFromEnv(),
    };
  }

  if (any.hookName === 'TaskResume' || any.taskResume) {
    return {
      source: 'resume',
      sessionId: String(any.taskId ?? ''),
      transcriptPath:
        typeof any.transcript_path === 'string'
          ? any.transcript_path
          : typeof any.transcriptPath === 'string'
            ? any.transcriptPath
            : getTranscriptPathFromEnv(),
    };
  }

  const srcRaw = String(any.source ?? any.Source ?? '').toLowerCase();
  const sessionId = String(any.session_id ?? any.sessionId ?? '');

  // Cursor sessionStart: no `source` field
  if (sessionId && !srcRaw) {
    return {
      source: 'startup',
      sessionId,
      transcriptPath:
        typeof any.transcript_path === 'string'
          ? any.transcript_path
          : typeof any.transcriptPath === 'string'
            ? any.transcriptPath
            : getTranscriptPathFromEnv(),
    };
  }

  return {
    source: srcRaw || 'startup',
    sessionId,
    transcriptPath:
      typeof any.transcript_path === 'string'
        ? any.transcript_path
        : typeof any.transcriptPath === 'string'
          ? any.transcriptPath
          : getTranscriptPathFromEnv(),
  };
}
