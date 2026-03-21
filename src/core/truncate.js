const DEFAULT_MAX_RESPONSE = 10 * 1024;
const DEFAULT_MAX_BASH_LINES = 500;

/**
 * @param {string} text
 * @param {number} [maxBytes]
 */
export function truncateResponse(text, maxBytes = DEFAULT_MAX_RESPONSE) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  const head = Math.floor(maxBytes * 0.6);
  const tail = maxBytes - head - 80;
  const start = buf.subarray(0, head).toString('utf8');
  const end = buf.subarray(buf.length - tail).toString('utf8');
  return `${start}\n\n… [PICKLEJAR: truncated ${buf.length} bytes to ~${maxBytes}] …\n\n${end}`;
}

/**
 * @param {string} output
 * @param {number} [maxLines]
 */
export function truncateBashOutput(output, maxLines = DEFAULT_MAX_BASH_LINES) {
  const lines = output.split('\n');
  if (lines.length <= maxLines) return output;
  const head = lines.slice(0, Math.floor(maxLines * 0.5));
  const tail = lines.slice(-Math.floor(maxLines * 0.5));
  return [
    ...head,
    `… [PICKLEJAR: truncated ${lines.length} lines to ~${maxLines}] …`,
    ...tail,
  ].join('\n');
}
