// Site Builder S4 — change a generated site with words: `bid site edit --project K --say "…"`.
// `bid.site.json` is the source of truth (brief, look, content); an edit changes that document and re-renders
// the files, never patches HTML by hand. Simple requests (a colour, a style, "remove the reviews", a new title)
// are understood here without AI; the rest becomes a short list of operations from the model (ai.mjs EDIT_SCHEMA),
// applied by the same applyEdits. Every edit is one Git commit ("Site: <the words>"), so Changes → Undo is a revert.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EngineError, exists, fetchT, readJSON, ev } from '../util.mjs';
import { t, msg, currentLang } from '../i18n.mjs';
import { accountStatus, cloudConfig, currentSession } from '../account.mjs';
import { chooseProvider, sseEvents } from '../ai/providers.mjs';
import { ownKey } from '../aikeys.mjs';
import { recordCost } from '../costs.mjs';
import { gitBin, gitSh } from '../gitbin.mjs';
import { loadTheme } from './themes.mjs';
import { resolveTokens, STYLES, STYLE_IDS, paletteIds } from './tokens.mjs';
import { renderSite } from './render.mjs';
import { applyEdits, EDIT_SCHEMA, SYSTEM, editPrompt } from './ai.mjs';
import { ownKeyCall } from './aicontent.mjs';
import { SITE_TEXT } from './generate.mjs';

const RECORD = 'bid.site.json';
const COMMIT_PREFIX = 'Site: ';

export const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The site record of a project, or null when the project was not made by the Site Builder. */
export function siteRecord(dir) {
  const r = readJSON(path.join(dir, RECORD), null);
  return r && r.schema === 'bid.site/1' && r.content?.pages?.index ? r : null;
}

/** `bid site info`: whether this project is a generated site and what the app may offer. */
export function siteInfo(project) {
  const r = siteRecord(project.path);
  if (!r) return { generated: false };
  const modified = modifiedFiles(project.path, r);
  return { generated: true, theme: r.theme, lang: r.brief?.lang || 'en', style: r.brief?.style || null, palette: r.brief?.palette || null, pages: Object.keys(r.content.pages), edits: (r.history || []).length, modified, history: siteHistory(project).slice(0, 10) };
}

/** Files the owner (or a developer) changed by hand since the site was rendered. */
export function modifiedFiles(dir, record) {
  const out = [];
  for (const [name, hash] of Object.entries(record.files || {})) {
    const p = path.join(dir, name);
    if (!exists(p)) continue;
    if (hashOf(fs.readFileSync(p, 'utf8')) !== hash) out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------- words we understand without a model

const PALETTE_WORDS = {
  sand: ['пясък', 'пясъчн', 'бежов', 'sand', 'beige'],
  forest: ['гора', 'горск', 'зелен', 'forest', 'green'],
  terracotta: ['теракот', 'оранжев', 'кафяв', 'terracotta', 'orange', 'brown'],
  sea: ['море', 'морск', 'син', 'sea', 'blue', 'navy'],
  lemon: ['лимон', 'жълт', 'lemon', 'yellow'],
  indigo: ['индиго', 'лилав', 'виолет', 'indigo', 'purple', 'violet'],
  coral: ['корал', 'червен', 'розов', 'coral', 'red', 'pink'],
  electric: ['електрик', 'неон', 'electric', 'neon', 'cyan'],
  ivory: ['слонова', 'кремав', 'бял', 'ivory', 'cream', 'white'],
  bordeaux: ['бордо', 'винен', 'bordeaux', 'burgundy', 'wine'],
  olive: ['маслин', 'olive'],
  champagne: ['шампанск', 'златист', 'злат', 'champagne', 'gold'],
};
const STYLE_WORDS = { calm: ['спокоен', 'спокойн', 'топъл', 'топло', 'calm', 'warm', 'soft'], bold: ['смел', 'ярък', 'енергич', 'bold', 'energetic', 'loud'], elegant: ['елегант', 'премиум', 'луксоз', 'elegant', 'premium', 'luxury'] };
const DARK_WORDS = ['тъмн', 'тъмен', 'dark', 'darker', 'night'];
const LIGHT_WORDS = ['светл', 'светъл', 'light', 'lighter', 'brighter'];
const SECTION_WORDS = {
  quotes: ['отзив', 'review', 'testimonial'],
  stats: ['статистик', 'числа', 'цифри', 'stats', 'numbers'],
  gallery: ['галери', 'снимки', 'gallery', 'photos'],
  faq: ['въпроси', 'faq', 'questions'],
  steps: ['стъпки', 'как работим', 'steps', 'process'],
  pricing: ['цени', 'ценоразпис', 'програми', 'планове', 'prices', 'pricing', 'programs', 'plans'],
  timeline: ['история', 'timeline'],
  chips: ['умения', 'тагове', 'skills', 'tags'],
  cta: ['призив', 'cta', 'call to action'],
};
const REMOVE_WORDS = ['махни', 'премахни', 'изтрий', 'скрий', 'без ', 'remove', 'delete', 'drop', 'hide', 'without'];

const has = (text, words) => words.some((w) => text.includes(w));

/** Ops for a request we understand without a model, or null. The site's current look decides the palette set. */
export function localEdit(say, record) {
  const text = String(say || '').toLowerCase().trim();
  if (!text) return null;
  const ops = [];
  const style = record.brief?.style || record.themeStyle || null;
  // style words
  const wantStyle = STYLE_IDS.find((id) => has(text, STYLE_WORDS[id]));
  const styleForPalette = wantStyle || style || 'calm';
  // palette words, within the style the site will have
  const wantPalette = Object.keys(PALETTE_WORDS).find((id) => has(text, PALETTE_WORDS[id]) && paletteIds(styleForPalette).includes(id));
  if (wantStyle || wantPalette) {
    ops.push({ op: 'style', style: wantStyle || null, palette: wantPalette || null });
  } else if (has(text, DARK_WORDS) || has(text, LIGHT_WORDS)) {
    // darker / lighter: the dark or light palette of the current style, else the nearest style that has one
    const dark = has(text, DARK_WORDS);
    for (const st of [styleForPalette, 'bold', 'elegant', 'calm']) {
      const pals = STYLES[st]?.palettes || {};
      const pick = Object.keys(pals).find((id) => !!pals[id].dark === dark);
      if (pick) {
        ops.push({ op: 'style', style: st === styleForPalette ? null : st, palette: pick });
        break;
      }
    }
  }
  // remove a section (a named section that is already gone is still "understood": nothing to do, no model)
  let understood = ops.length > 0;
  if (has(text, REMOVE_WORDS)) {
    for (const [type, words] of Object.entries(SECTION_WORDS)) {
      if (!has(text, words)) continue;
      understood = true;
      for (const [pid, page] of Object.entries(record.content.pages)) {
        (page.sections || []).forEach((s, index) => {
          const st = s.type === 'programs' ? 'pricing' : s.type === 'audience' ? 'cards' : s.type;
          if (st === type || (type === 'pricing' && s.type === 'menu')) ops.push({ op: 'drop_section', page: pid, section: index });
        });
      }
    }
  }
  // a new title: заглавие(то) … "X" / title … "X"
  const quoted = /[„"“']([^„"”“']{3,90})[“"”']/.exec(say || '');
  if (quoted && /заглави|title|headline/.test(text)) ops.push({ op: 'set_text', page: 'index', section: null, field: 'title', value: quoted[1] });
  return ops.length ? ops : understood ? [] : null;
}

// ---------------------------------------------------------------- the model (own key or the cloud)

async function cloudEditOps({ brief, content, look, say, onStep }) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/site-gen`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ mode: 'edit', brief, content, look, say, locale: currentLang(), operationId: crypto.randomUUID() }),
    }, Number(process.env.BID_AI_CONNECT_MS) || 60000);
  } catch (e) {
    throw new EngineError(msg('ai.network', { error: e.message }), 'network');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) || {};
    if (res.status === 404 && j.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'site-gen' }), 'cloud_function_missing');
    if (res.status === 402) throw new EngineError(msg('ai.quotaExhausted', { renewsAt: j.renewsAt || '—' }), 'quota_exhausted', 8);
    if (res.status === 403) throw new EngineError(msg('ai.unavailable.noPlan'), 'ai_unavailable');
    if (res.status === 429) throw new EngineError(msg('ai.rateLimited', { name: 'Before I Deploy AI' }), 'ai_rate_limited');
    if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
    throw new EngineError(msg('ai.providerHttp', { name: 'site-gen', status: res.status, detail: j.error || '' }), 'ai_failed');
  }
  let result = null;
  const usage = { input: 0, output: 0, model: null };
  for await (const { data } of sseEvents(res.body, { abort: res.abortController })) {
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.type === 'step') onStep(j.id, j.status, j);
    else if (j.type === 'usage') Object.assign(usage, { input: j.input, output: j.output, model: j.model, charged: j.charged, balance: j.balance });
    else if (j.type === 'result') result = j;
    else if (j.type === 'error') throw new EngineError(msg('ai.providerError', { name: 'site-gen', error: j.error || 'error' }), 'ai_failed');
    else if (j.type === 'done') break;
  }
  if (!result || !Array.isArray(result.ops)) throw new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed');
  return { ops: result.ops, summary: result.summary || '', usage };
}

async function aiEditOps({ brief, content, look, say, provider: requested, onStep }) {
  const status = await accountStatus();
  const provider = chooseProvider({ features: status.features || null, requested });
  if (provider === 'cloud') return { provider, ...(await cloudEditOps({ brief, content, look, say, onStep })) };
  if (provider === 'openai') throw new EngineError(msg('newsite.ai.anthropicOnly'), 'ai_unavailable');
  if (!ownKey('anthropic')) throw new EngineError(msg('ai.unavailable.noKey', { provider: 'anthropic' }), 'ai_unavailable');
  const model = status?.settings?.['ai.models']?.fast || 'claude-sonnet-5-5';
  onStep('edit', 'running', { model });
  const r = await ownKeyCall('anthropic')({ model, system: SYSTEM, prompt: editPrompt(brief, content, look, say), schema: EDIT_SCHEMA, maxTokens: 6000, effort: 'low' });
  onStep('edit', 'pass', { model: r.usage?.model || model });
  if (!r.json || !Array.isArray(r.json.ops)) throw new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed');
  return { provider, ops: r.json.ops, summary: r.json.summary || '', usage: r.usage };
}

// ---------------------------------------------------------------- render + write + commit

function renderRecord(record, theme) {
  const text = SITE_TEXT[record.brief.lang] || SITE_TEXT.en;
  const site = {
    name: record.brief.name,
    lang: record.brief.lang,
    mark: theme.mark,
    tokens: record.tokens,
    description: record.brief.description || record.content.description || t(text.description, { name: record.brief.name }),
    privacyTitle: t(text.privacyTitle),
    privacyText: t(text.privacyText),
    home: t(text.home),
    notFoundTitle: t(text.notFoundTitle),
    notFoundText: t(text.notFoundText),
  };
  return renderSite(site, record.content);
}

/**
 * `bid site edit`: applies the words to the site. `force` overwrites files the owner changed by hand; without it
 * such a change is refused (code `site_modified`) and the files are listed, so nothing is lost silently.
 */
export async function editSite(project, { say, provider = null, force = false, dryRun = false } = {}) {
  if (!say || say === true || !String(say).trim()) throw new EngineError(msg('site.edit.missingSay'), 'usage', 2);
  const dir = project.path;
  const record = siteRecord(dir);
  if (!record) throw new EngineError(msg('site.edit.notGenerated'), 'not_generated');
  const theme = loadTheme(record.theme);
  if (!theme) throw new EngineError(msg('newsite.unknownTemplate', { template: record.theme }), 'not_found');
  const words = String(say).trim().slice(0, 400);
  const t0 = Date.now();
  const onStep = (id, state, info = {}) => ev.step(`site.${id}`, { label: t('site.edit.step'), category: 'AI', status: state === 'running' ? 'running' : state === 'pass' ? 'pass' : 'fail', summary: state === 'running' ? t('newsite.ai.working', { model: info.model || t('ai.step.cloudModel') }) : state === 'pass' ? t('newsite.ai.done') : info.error || '' });

  // 1. the ops: words we know, else the model
  let ops = localEdit(words, { ...record, themeStyle: theme.style });
  let summary = '';
  let provider_ = 'local';
  let usage = null;
  if (!ops) {
    const look = { style: record.brief.style || theme.style, palette: record.brief.palette || null, palettes: Object.fromEntries(STYLE_IDS.map((s) => [s, paletteIds(s)])) };
    const r = await aiEditOps({ brief: record.brief, content: record.content, look, say: words, provider, onStep });
    ops = r.ops;
    summary = r.summary;
    provider_ = r.provider;
    usage = r.usage;
  }

  // 2. apply to the document
  const { content, look, applied, refused } = applyEdits(record.content, ops);
  if (!applied.length) {
    const why = refused[0]?.why || summary || '';
    throw Object.assign(new EngineError(msg('site.edit.nothing', { why }), 'nothing'), { summary, refused });
  }
  const next = { ...record, content, brief: { ...record.brief }, history: [...(record.history || [])] };
  if (look.style && STYLE_IDS.includes(look.style)) next.brief.style = look.style;
  if (look.palette) {
    // a palette needs a style to belong to: the site's own, else the theme's
    const st = next.brief.style || theme.style || 'calm';
    if (paletteIds(st).includes(look.palette)) {
      next.brief.style = st;
      next.brief.palette = look.palette;
    } else refused.push({ op: { op: 'style', palette: look.palette }, why: 'unknown palette for this style' });
  }
  if (look.style && !look.palette && look.style !== record.brief.style) next.brief.palette = null;
  next.tokens = resolveTokens(theme.tokens, { style: next.brief.style, palette: next.brief.palette });

  // 3. render and find what changes; refuse to overwrite hand-edited files unless forced
  const files = renderRecord(next, theme);
  const old = renderRecord(record, theme);
  const changed = Object.keys(files).filter((name) => files[name] !== old[name] || !exists(path.join(dir, name)));
  const removed = Object.keys(old).filter((name) => !(name in files));
  if (!changed.length && !removed.length) throw Object.assign(new EngineError(msg('site.edit.nothing', { why: t('site.edit.sameResult') }), 'nothing'), { summary, refused, applied });
  const modified = modifiedFiles(dir, record).filter((name) => changed.includes(name) || removed.includes(name));
  if (modified.length && !force) throw Object.assign(new EngineError(msg('site.edit.modified', { files: modified.join(', ') }), 'site_modified'), { modified, applied, summary });
  const result = { applied, refused: refused.map((r) => r.why), summary, provider: provider_, usage, changed, removed, dryRun: !!dryRun, duration: (Date.now() - t0) / 1000 };
  if (dryRun) return result;
  for (const name of changed) fs.writeFileSync(path.join(dir, name), files[name]);
  for (const name of removed) fs.rmSync(path.join(dir, name), { force: true });
  next.files = Object.fromEntries(Object.entries(files).map(([name, body]) => [name, hashOf(body)]));
  next.history.push({ at: new Date().toISOString(), say: words, applied, provider: provider_ });
  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(dir, RECORD), JSON.stringify(next, null, 2) + '\n');

  // 4. one commit per edit, in the owner's words
  let commit = null;
  if (gitBin() && exists(path.join(dir, '.git'))) {
    gitSh(['add', '-A'], { cwd: dir });
    const c = gitSh(['-c', 'user.email=beforeideploy@local', '-c', 'user.name=Before I Deploy', 'commit', '-qm', `${COMMIT_PREFIX}${words}`], { cwd: dir });
    if (c.code === 0) commit = gitSh(['rev-parse', '--short', 'HEAD'], { cwd: dir }).stdout.trim();
  }
  if (usage) {
    const amount = usage.charged ?? (usage.input || 0) + (usage.output || 0);
    recordCost({ project: project.key, projectName: project.name, service: provider_ === 'cloud' ? 'ai-cloud' : `ai-${provider_}`, op: 'site.edit', amount, unit: usage.charged != null ? 'credits' : 'tokens', estimated: false, ref: usage.model || null });
  }
  return { ...result, commit };
}

/** The edits so far (newest first): the Site: commits, or the record's history when there is no Git. */
export function siteHistory(project) {
  const dir = project.path;
  if (gitBin() && exists(path.join(dir, '.git'))) {
    const r = gitSh(['log', '--format=%h%x00%s%x00%cI', '-n', '50'], { cwd: dir });
    if (r.code === 0) {
      return r.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\0'))
        .filter(([, s]) => s.startsWith(COMMIT_PREFIX) || s.startsWith('New site: ') || s.startsWith('Revert "Site: '))
        .map(([sha, subject, at]) => ({ sha, say: subject.startsWith(COMMIT_PREFIX) ? subject.slice(COMMIT_PREFIX.length) : subject, at, kind: subject.startsWith(COMMIT_PREFIX) ? 'edit' : subject.startsWith('Revert') ? 'undo' : 'created' }));
    }
  }
  const record = siteRecord(dir);
  return [...(record?.history || [])].reverse().map((h) => ({ sha: null, say: h.say, at: h.at, kind: 'edit' }));
}

/** `bid site undo`: reverts the last edit (a new commit, so nothing is rewritten) and reloads the record. */
export function undoSite(project) {
  const dir = project.path;
  if (!siteRecord(dir)) throw new EngineError(msg('site.edit.notGenerated'), 'not_generated');
  if (!gitBin() || !exists(path.join(dir, '.git'))) throw new EngineError(msg('site.edit.noGit'), 'git_missing');
  const last = siteHistory(project).find((h) => h.kind === 'edit');
  if (!last) throw new EngineError(msg('site.edit.nothingToUndo'), 'nothing');
  const dirty = gitSh(['status', '--porcelain'], { cwd: dir });
  if (dirty.code === 0 && dirty.stdout.trim()) throw new EngineError(msg('site.edit.dirty'), 'dirty');
  const r = gitSh(['-c', 'user.email=beforeideploy@local', '-c', 'user.name=Before I Deploy', 'revert', '--no-edit', last.sha], { cwd: dir });
  if (r.code !== 0) throw new EngineError(msg('site.edit.undoFailed', { error: (r.stderr || r.stdout).trim().slice(0, 200) }), 'git_failed');
  return { reverted: last, commit: gitSh(['rev-parse', '--short', 'HEAD'], { cwd: dir }).stdout.trim() };
}
