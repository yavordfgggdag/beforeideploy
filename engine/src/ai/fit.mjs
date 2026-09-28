// Keeps an AI prompt under the size limit (V10 WP3: 60 000 characters, the same limit the ai-fix function
// enforces). Build logs are the bulky part; when the prompt is too long we keep the start and the end
// (context and the answer format), every line that looks like an error with two lines around it, and mark
// what was left out. No dependencies, so tests can import it directly.

export const PROMPT_MAX_CHARS = 60000;

const IMPORTANT = /error|fail|failed|exception|cannot|can't|unable|not found|missing|undefined|warn|✖|✗|×|ERR!|TS\d{3,5}|at .+:\d+:\d+/i;

export function fitPrompt(text, max = PROMPT_MAX_CHARS) {
  if (text.length <= max) return text;
  const lines = text.split('\n');
  const keep = new Set();
  const HEAD = 60;
  const TAIL = 80;
  for (let i = 0; i < Math.min(HEAD, lines.length); i++) keep.add(i);
  for (let i = Math.max(0, lines.length - TAIL); i < lines.length; i++) keep.add(i);
  for (let i = 0; i < lines.length; i++) {
    if (IMPORTANT.test(lines[i])) for (let j = i - 2; j <= i + 2; j++) if (j >= 0 && j < lines.length) keep.add(j);
  }
  const out = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (skipped) out.push(`… (${skipped} lines left out) …`);
      skipped = 0;
      out.push(lines[i].length > 2000 ? `${lines[i].slice(0, 2000)} …` : lines[i]);
    } else skipped++;
  }
  if (skipped) out.push(`… (${skipped} lines left out) …`);
  let result = out.join('\n');
  if (result.length > max) {
    // still too long (e.g. thousands of error lines): keep 40 % from the start and 60 % from the end
    const marker = '\n… (middle of the log left out) …\n';
    const room = max - marker.length;
    result = result.slice(0, Math.floor(room * 0.4)) + marker + result.slice(result.length - Math.ceil(room * 0.6));
  }
  return result;
}
