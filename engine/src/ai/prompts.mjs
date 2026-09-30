// Versioned prompt resources for the embedded assistant (V11 RC).
//
// Every prompt is a JSON file in engine/prompts/<id>.v<n>.json with an id, a version, the input variables
// it needs, the output schema the model must satisfy and the template text. Nothing else composes prompt
// text: the engine renders a template with validated inputs, the model answers with one JSON object, and
// the answer is validated here before anything in the app or the engine looks at it. A `ref` on a schema
// field ties it to something the engine supplied (evidence ids, allowed paths, the engine's own status), so
// the model cannot cite evidence that does not exist, touch a file outside the scope, or "upgrade" a failed
// verification to a success.
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_DIR, EngineError } from '../util.mjs';
import { msg } from '../i18n.mjs';

export const PROMPTS_DIR = () => path.join(ENGINE_DIR, 'prompts');

const cache = new Map();

/** Every prompt on disk: id, version, kind, purpose and the localized titles. */
export function listPrompts() {
  let names = [];
  try {
    names = fs.readdirSync(PROMPTS_DIR()).filter((f) => /^[a-z_]+\.v\d+\.json$/.test(f));
  } catch {
    return [];
  }
  const byId = new Map();
  for (const f of names) {
    const p = JSON.parse(fs.readFileSync(path.join(PROMPTS_DIR(), f), 'utf8'));
    const prev = byId.get(p.id);
    if (!prev || prev.version < p.version) byId.set(p.id, p);
  }
  return [...byId.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, version: p.version, kind: p.kind, purpose: p.purpose, title: p.locales, inputs: p.input?.required || [], outputs: p.output?.required || [] }));
}

/** The newest version of a prompt (or the given one). Throws `prompt_not_found`. */
export function loadPrompt(id, version = null) {
  const key = `${id}@${version || 'latest'}`;
  if (cache.has(key)) return cache.get(key);
  const dir = PROMPTS_DIR();
  let file = null;
  if (version) file = path.join(dir, `${id}.v${version}.json`);
  else {
    const versions = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
      .map((f) => new RegExp(`^${id}\\.v(\\d+)\\.json$`).exec(f))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
    if (versions.length) file = path.join(dir, `${id}.v${versions[0]}.json`);
  }
  if (!file || !fs.existsSync(file)) throw new EngineError(msg('assistant.promptNotFound', { id }), 'prompt_not_found');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  cache.set(key, p);
  return p;
}

/**
 * Renders a template with its variables. Required inputs must be present; optional ones default to an empty
 * string; a `{{name}}` the prompt does not declare is an error (no accidental holes for injected text).
 */
export function renderPrompt(prompt, vars = {}) {
  const declared = prompt.input?.properties || {};
  for (const r of prompt.input?.required || []) {
    if (vars[r] === undefined || vars[r] === null || vars[r] === '') throw new EngineError(msg('assistant.promptInputMissing', { id: prompt.id, name: r }), 'prompt_input_missing', 2);
  }
  return String(prompt.template).replace(/\{\{([a-z_]+)\}\}/g, (_, name) => {
    if (!(name in declared)) throw new EngineError(msg('assistant.promptInputMissing', { id: prompt.id, name }), 'prompt_input_missing', 2);
    const v = vars[name];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  });
}

/** Finds the JSON object in a model answer (plain, or inside a ``` fence, or with prose around it). */
export function extractJSON(text) {
  const s = String(text || '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const candidates = [];
  if (fence) candidates.push(fence[1]);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(s.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {}
  }
  return null;
}

/**
 * Validates a model answer against the prompt's output schema (type, required, enum, items, ref).
 * refs: { evidence: Set<string>, allowed_paths: Set<string>, engine_status: string }.
 * Returns { ok, errors[] } — never throws for model mistakes.
 */
export function validateOutput(prompt, value, refs = {}) {
  const errors = [];
  const schema = prompt.output;
  if (!schema) return { ok: true, errors };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['answer is not a JSON object'] };
  const extra = Object.keys(value).filter((k) => !(k in (schema.properties || {})));
  if (extra.length) errors.push(`unexpected fields: ${extra.join(', ')}`);
  check(value, { type: 'object', ...schema }, '$', errors, refs);
  return { ok: errors.length === 0, errors };
}

function check(v, s, at, errors, refs) {
  if (!s) return;
  const type = s.type;
  if (type === 'string') {
    if (typeof v !== 'string') return errors.push(`${at}: expected string`);
    if (s.enum && !s.enum.includes(v)) return errors.push(`${at}: must be one of ${s.enum.join('|')}`);
    if (s.ref) checkRef(v, s.ref, at, errors, refs);
    return;
  }
  if (type === 'array') {
    if (!Array.isArray(v)) return errors.push(`${at}: expected array`);
    v.forEach((x, i) => check(x, s.items, `${at}[${i}]`, errors, refs));
    return;
  }
  if (type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return errors.push(`${at}: expected object`);
    for (const r of s.required || []) if (v[r] === undefined) errors.push(`${at}.${r}: required`);
    for (const [k, sub] of Object.entries(s.properties || {})) if (v[k] !== undefined) check(v[k], sub, `${at}.${k}`, errors, refs);
    return;
  }
}

function checkRef(v, ref, at, errors, refs) {
  if (ref === 'evidence') {
    if (refs.evidence && !refs.evidence.has(v)) errors.push(`${at}: unknown evidence id ${v}`);
  } else if (ref === 'allowed_paths') {
    // checked as written: `src/../x`, absolute paths and empty prefixes never pass (audit E1)
    const p = String(v);
    const segs = p.split(/[\\/]+/);
    const malformed = !p || p.startsWith('/') || p.includes('\0') || segs.some((s) => s === '..' || s === '.') || /^[a-zA-Z]:/.test(p);
    const inDir = refs.allowed_dirs && [...refs.allowed_dirs].some((d) => d && d.endsWith('/') && p.startsWith(d));
    if (refs.allowed_paths && (malformed || (!refs.allowed_paths.has(p) && !inDir))) errors.push(`${at}: path ${v} is outside the allowed paths`);
  } else if (ref === 'engine_status') {
    if (refs.engine_status !== undefined && v !== refs.engine_status) errors.push(`${at}: must equal the engine status "${refs.engine_status}" (got "${v}")`);
  }
}
