import fs from 'node:fs/promises';

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
