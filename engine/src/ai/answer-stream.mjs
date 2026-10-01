/** Incrementally decodes one schema-selected top-level JSON string. Raw JSON never reaches the UI.
 * Nested objects, code/file bodies, property names and incomplete escapes stay private. */
export class AnswerStream {
  constructor(field = 'answer') {
    this.field = field;
    this.depth = 0;
    this.started = false;
    this.inString = false;
    this.expectKey = false;
    this.key = '';
    this.kind = '';
    this.rawKey = '';
    this.escape = false;
    this.unicode = null;
    this.high = '';
    this.done = false;
  }
  push(chunk) {
    let out = '';
    const decoded = (text) => {
      if (this.kind !== 'answer' || this.done) return;
      for (const c of text) {
        const code = c.charCodeAt(0);
        if (this.high) {
          if (code >= 0xDC00 && code <= 0xDFFF) { out += this.high + c; this.high = ''; continue; }
          out += '\uFFFD'; this.high = '';
        }
        if (code >= 0xD800 && code <= 0xDBFF && c.length === 1) this.high = c;
        else out += c;
      }
    };
    for (const c of String(chunk)) {
      if (this.done) break;
      if (!this.started) {
        if (c === '{') { this.started = true; this.depth = 1; this.expectKey = true; }
        continue;
      }
      if (this.inString) {
        if (this.kind === 'key') this.rawKey += c;
        if (this.unicode !== null) {
          if (!/[0-9a-f]/i.test(c)) { this.done = true; break; }
          this.unicode += c;
          if (this.unicode.length === 4) { decoded(String.fromCharCode(parseInt(this.unicode, 16))); this.unicode = null; }
        } else if (this.escape) {
          this.escape = false;
          if (c === 'u') this.unicode = '';
          else if ('"\\/bfnrt'.includes(c)) decoded(({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c]);
          else { this.done = true; break; }
        } else if (c === '\\') this.escape = true;
        else if (c === '"') {
          this.inString = false;
          if (this.kind === 'key') {
            try { this.key = JSON.parse('"' + this.rawKey); } catch { this.done = true; }
            this.expectKey = false;
          } else if (this.kind === 'answer') {
            if (this.high) { out += '\uFFFD'; this.high = ''; }
            this.done = true;
          }
        } else if (c.charCodeAt(0) < 32) { this.done = true; break; }
        else decoded(c);
        continue;
      }
      if (c === '"') {
        this.inString = true;
        this.kind = this.depth === 1 && this.expectKey ? 'key' : this.depth === 1 && this.key === this.field ? 'answer' : 'ignore';
        this.rawKey = '';
      } else if (c === '{' || c === '[') this.depth++;
      else if (c === '}' || c === ']') { this.depth--; if (!this.depth) this.done = true; }
      else if (c === ',' && this.depth === 1) { this.expectKey = true; this.key = ''; }
    }
    return out;
  }
}
