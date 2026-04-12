import fs from 'node:fs/promises';

/**
 * Best-effort: read head of JSONL transcript and extract the first user message as goal.
 * @param {string} transcriptPath
 * @returns {Promise<string | undefined>}
 */
export async function extractGoalFromTranscript(transcriptPath) {
  if (!transcriptPath) return undefined;
  try {
    const buf = await fs.readFile(transcriptPath);
    const text = buf.toString('utf8');
    const head = text.slice(0, 8_000);
    const lines = head.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        const role = row?.message?.role ?? row?.role;
        if (role !== 'user') continue;
        const content =
          row?.message?.content ??
          row?.content ??
          row?.text;
        if (typeof content === 'string' && content.trim().length > 0) {
          return content.trim().slice(0, 2_000);
        }
        if (Array.isArray(content)) {
          const joined = content
            .map((c) => (typeof c === 'string' ? c : c?.text ?? ''))
            .join(' ')
            .trim();
          if (joined.length > 0) return joined.slice(0, 2_000);
        }
      } catch {
        /* next line */
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Best-effort: read tail of JSONL transcript and guess last planned assistant text.
 * @param {string} transcriptPath
 * @returns {Promise<string | undefined>}
 */
export async function extractLastPlannedAction(transcriptPath) {
  if (!transcriptPath) return undefined;
  try {
    const buf = await fs.readFile(transcriptPath);
    const text = buf.toString('utf8');
    const tail = text.slice(-32_000);
    const lines = tail.split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        const row = JSON.parse(lines[i]);
        const content =
          row?.message?.content ??
          row?.content ??
          row?.text ??
          row?.assistant?.content;
        if (typeof content === 'string' && content.trim().length > 20) {
          const snippet = content.trim().slice(0, 2000);
          return snippet;
        }
        if (Array.isArray(content)) {
          const joined = content
            .map((c) => (typeof c === 'string' ? c : c?.text ?? ''))
            .join('\n')
            .trim();
          if (joined.length > 20) return joined.slice(0, 2000);
        }
      } catch {
        /* next line */
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
