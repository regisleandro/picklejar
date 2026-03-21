/**
 * @param {string} text
 * @param {string[]} patterns - regex sources (no flags)
 */
export function redactWithPatterns(text, patterns) {
  let out = text;
  for (const src of patterns) {
    if (!src) continue;
    try {
      const re = new RegExp(src, 'g');
      out = out.replace(re, '[REDACTED]');
    } catch {
      /* skip invalid pattern */
    }
  }
  return out;
}
