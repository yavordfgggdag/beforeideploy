// Site Builder S3 — `bid new content`: the AI writes the site's texts for a brief. Two ways to the model, one
// pipeline (ai.mjs): the owner's own Anthropic key (the steps run here), or the metered `site-gen` Edge
// Function (the steps run there, the central key never leaves the backend). Nothing is written to the site
// folder: the result is a content file the app hands to `bid new preview/generate --content`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CACHE_DIR, EngineError, ensureDir, ev, fetchT } from '../util.mjs';
import { t, msg, currentLang } from '../i18n.mjs';
import { accountStatus, cloudConfig, currentSession } from '../account.mjs';
import { chooseProvider, stream, sseEvents } from '../ai/providers.mjs';
import { cloudEngine } from '../ai/assistant.mjs';
import { ownKey } from '../aikeys.mjs';
import { recordCost } from '../costs.mjs';
import { loadTheme } from './themes.mjs';
import { normalizeBrief, applyBrief } from './brief.mjs';
import { runPipeline, STEPS } from './ai.mjs';

const STEP_LABEL = { plan: 'newsite.ai.plan', content: 'newsite.ai.content', review: 'newsite.ai.review' };

/** Where `bid new content` leaves its answer; the app passes the path back to preview/generate. */
export function contentFile(id = crypto.randomUUID()) {
  const dir = path.join(CACHE_DIR, 'site-content');
  ensureDir(dir);
  return path.join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
}

/** Reads a content file (or inline JSON) for --content and checks its shape. */
export function readContentArg(value) {
  if (!value || value === true) return null;
  const raw = String(value).trim();
  let data;
  try {
    data = raw.startsWith('{') ? JSON.parse(raw) : JSON.parse(fs.readFileSync(raw, 'utf8'));
  } catch {
    throw new EngineError(msg('newsite.badContent'), 'usage', 2);
  }
  const content = data && data.schema === 'bid.site-content/1' ? data.content : data;
  if (!content || typeof content !== 'object' || !content.pages?.index) throw new EngineError(msg('newsite.badContent'), 'usage', 2);
  return content;
}

// ---------------------------------------------------------------- own key: the steps run here

export function ownKeyCall(provider) {
  return async ({ model, system, prompt, schema, maxTokens, effort }) => {
    let text = '';
    const usage = { input: 0, output: 0, model };
    for await (const e of stream(provider, { model, system, messages: [{ role: 'user', content: prompt }], maxTokens, effort, format: schema })) {
      if (e.type === 'delta') text += e.text;
      else if (e.type === 'usage') {
        if (e.input != null) usage.input = e.input;
        if (e.output != null) usage.output = e.output;
        if (e.model) usage.model = e.model;
        if (e.stopReason === 'max_tokens') throw new EngineError(msg('newsite.ai.truncated'), 'ai_failed');
      }
    }
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed');
    }
    return { json, usage };
  };
}

// ---------------------------------------------------------------- cloud: the steps run in site-gen

async function cloudContent({ brief, recipe, onStep }) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/site-gen`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ brief, recipe, locale: currentLang(), operationId: crypto.randomUUID(), engine: cloudEngine() }),
    }, Number(process.env.BID_AI_CONNECT_MS) || 60000);
  } catch (e) {
    throw new EngineError(msg('ai.network', { error: e.message }), 'network');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) || {};
    if (res.status === 404 && j.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'site-gen' }), 'cloud_function_missing');
    if (j.code === 'engine_unavailable') throw new EngineError(msg('ai.engineUnavailable', { engine: j.engine || cloudEngine() }), 'engine_unavailable');
    if (res.status === 402) throw new EngineError(msg('ai.quotaExhausted', { renewsAt: j.renewsAt || '—' }), 'quota_exhausted', 8);
    if (res.status === 403 && ['credits_release', 'guard_24h', 'guard_7d', 'pack_rate'].includes(j.code)) {
      const at = j.readyAt ? new Date(j.readyAt).toLocaleString() : '—';
      const key = { credits_release: 'ai.creditsRelease', guard_24h: 'ai.guard24h', guard_7d: 'ai.guard7d', pack_rate: 'ai.packRate' }[j.code];
      throw Object.assign(new EngineError(msg(key, { at }), j.code), { readyAt: j.readyAt ?? null });
    }
    if (res.status === 403) throw new EngineError(msg('ai.unavailable.noPlan'), 'ai_unavailable');
    if (res.status === 429) throw new EngineError(msg('ai.rateLimited', { name: 'Before I Deploy AI' }), 'ai_rate_limited');
    if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
    throw new EngineError(msg('ai.providerHttp', { name: 'site-gen', status: res.status, detail: j.error || '' }), 'ai_failed');
  }
  let result = null;
  const usage = { input: 0, output: 0, model: null };
  for await (const { data } of sseEvents(res.body, { abort: res.abortController, idleMs: Number(process.env.BID_AI_IDLE_MS) || 180000 })) {
    let j;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    if (j.type === 'step') onStep(j.id, j.status, j);
    else if (j.type === 'usage') Object.assign(usage, { input: j.input, output: j.output, model: j.model, charged: j.charged, balance: j.balance });
    else if (j.type === 'result') result = j;
    else if (j.type === 'error') throw new EngineError(msg('ai.providerError', { name: 'site-gen', error: j.error || 'error' }), j.code === 'ai_bad_answer' ? 'ai_bad_answer' : 'ai_failed');
    else if (j.type === 'done') break;
  }
  if (!result?.content) throw new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed');
  return { content: result.content, plan: result.plan || null, styleSuggestion: result.styleSuggestion || null, usage };
}

// ---------------------------------------------------------------- the command

/**
 * `bid new content --brief …`: the AI's texts for the brief, as a content file + usage. Progress goes out as
 * `step` events (plan / content / review) so the app shows what is happening.
 */
export async function siteContent({ brief: input, provider: requested = null }) {
  const brief = normalizeBrief(input);
  const theme = loadTheme(brief.theme);
  if (!theme) throw new EngineError(msg('newsite.unknownTemplate', { template: brief.theme }), 'usage', 2);
  // the recipe the model rewrites already carries the owner's services and contacts; photos come at save time
  const recipe = applyBrief(theme, { ...brief, photos: [] }, []);
  const status = await accountStatus();
  const provider = chooseProvider({ features: status.features || null, requested });
  const t0 = Date.now();
  const onStep = (id, state, info = {}) => {
    const label = t(STEP_LABEL[id] || id);
    const summary = state === 'running' ? t('newsite.ai.working', { model: info.model || t('ai.step.cloudModel') }) : state === 'pass' ? t('newsite.ai.done') : info.error || '';
    ev.step(`site.${id}`, { label, category: 'AI', status: state === 'running' ? 'running' : state === 'pass' ? 'pass' : state === 'warn' ? 'warn' : 'fail', summary });
  };
  let out;
  if (provider === 'cloud') {
    out = await cloudContent({ brief, recipe, onStep });
  } else {
    if (provider === 'openai') throw new EngineError(msg('newsite.ai.anthropicOnly'), 'ai_unavailable');
    if (!ownKey('anthropic')) throw new EngineError(msg('ai.unavailable.noKey', { provider: 'anthropic' }), 'ai_unavailable');
    const models = status?.settings?.['ai.models'] ? { content: status.settings['ai.models'].standard || undefined } : {};
    out = await runPipeline({ brief, recipe, call: ownKeyCall('anthropic'), models, onStep });
  }
  const file = contentFile();
  fs.writeFileSync(file, JSON.stringify({ schema: 'bid.site-content/1', createdAt: new Date().toISOString(), theme: theme.id, lang: brief.lang, provider, usage: out.usage, content: out.content }, null, 2));
  const amount = out.usage.charged ?? (out.usage.input || 0) + (out.usage.output || 0);
  recordCost({ project: null, projectName: brief.name, service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: 'site.create', amount, unit: out.usage.charged != null ? 'credits' : 'tokens', estimated: false, ref: out.usage.model || null });
  return {
    contentFile: file,
    provider,
    model: out.usage.model || out.usage.steps?.content?.model || null,
    usage: out.usage,
    styleSuggestion: out.styleSuggestion || null,
    pages: Object.keys(out.content.pages || {}),
    steps: STEPS,
    duration: (Date.now() - t0) / 1000,
  };
}
