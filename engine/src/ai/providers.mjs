// AI providers (V10 WP3). Three ways to reach a model, one event stream:
//   anthropic / openai — the user's own key from the Keychain (vip/admin)
//   cloud              — the metered `ai-fix` Edge Function (normal users with a plan; the central key never leaves the backend)
// Every provider yields { type: 'delta', text } · { type: 'usage', input?, output?, model? } · { type: 'done', stopReason? }.
import { EngineError } from '../util.mjs';
import { msg } from '../i18n.mjs';
import { ownKey } from '../aikeys.mjs';
import { cloudConfig, currentSession } from '../account.mjs';

// Base URLs are overridable for tests (the test suite runs fake endpoints on 127.0.0.1).
export const ANTHROPIC_API = () => process.env.BID_ANTHROPIC_API || 'https://api.anthropic.com';
export const OPENAI_API = () => process.env.BID_OPENAI_API || 'https://api.openai.com';

// ---------------------------------------------------------------- SSE

/** Turns a text/event-stream body into { event, data } objects (multi-line data joined with \n). */
export async function* sseEvents(body) {
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (raw) => {
    let event = 'message';
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const ev = parse(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (ev) yield ev;
    }
  }
  const last = parse(buf);
  if (last) yield last;
}

async function post(url, headers, body) {
  try {
    return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers }, body: JSON.stringify(body) });
  } catch (e) {
    throw new EngineError(msg('ai.network', { error: e.message }), 'network');
  }
}

async function apiError(name, res) {
  const text = await res.text().catch(() => '');
  let detail = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    detail = j.error?.message || j.error || j.message || detail;
  } catch {}
  if (res.status === 401 || res.status === 403) return new EngineError(msg('ai.keyRejected', { name }), 'unauthorized');
  if (res.status === 429) return new EngineError(msg('ai.rateLimited', { name }), 'ai_rate_limited');
  return new EngineError(msg('ai.providerHttp', { name, status: res.status, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }), 'ai_failed');
}

const parseJSON = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- Anthropic (own key)

async function* anthropic({ key, model, system, messages, maxTokens = 8000, effort = 'medium' }) {
  const body = { model, max_tokens: maxTokens, system, messages, stream: true };
  // effort is not accepted by the Haiku 4.5 family; the other current models take it in output_config
  if (effort && !/haiku/i.test(model)) body.output_config = { effort };
  const base = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  // A declined request is re-run server-side on Anthropic's recommended fallback model (beta).
  let res = await post(`${ANTHROPIC_API()}/v1/messages`, { ...base, 'anthropic-beta': 'server-side-fallback-2026-07-01' }, { ...body, fallbacks: 'default' });
  if (res.status === 400) {
    const text = await res.text().catch(() => '');
    if (/fallback/i.test(text)) res = await post(`${ANTHROPIC_API()}/v1/messages`, base, body); // account without the beta
    else throw await apiError('Anthropic', new Response(text, { status: 400 }));
  }
  if (!res.ok) throw await apiError('Anthropic', res);
  let gotText = false;
  for await (const { data } of sseEvents(res.body)) {
    const j = parseJSON(data);
    if (!j) continue;
    switch (j.type) {
      case 'message_start':
        yield { type: 'usage', input: j.message?.usage?.input_tokens ?? 0, model: j.message?.model || model };
        break;
      case 'content_block_delta':
        if (j.delta?.type === 'text_delta' && j.delta.text) {
          gotText = true;
          yield { type: 'delta', text: j.delta.text };
        }
        break;
      case 'message_delta':
        yield { type: 'usage', output: j.usage?.output_tokens ?? undefined, stopReason: j.delta?.stop_reason };
        if (j.delta?.stop_reason === 'refusal' && !gotText) throw new EngineError(msg('ai.refused'), 'ai_refused');
        break;
      case 'message_stop':
        yield { type: 'done' };
        return;
      case 'error':
        throw new EngineError(msg('ai.providerError', { name: 'Anthropic', error: j.error?.message || 'error' }), 'ai_failed');
      default:
        break; // ping, content_block_start/stop, thinking deltas
    }
  }
  yield { type: 'done' };
}

// ---------------------------------------------------------------- OpenAI (own key)

async function* openai({ key, model, system, messages, maxTokens = 8000 }) {
  const res = await post(
    `${OPENAI_API()}/v1/chat/completions`,
    { Authorization: `Bearer ${key}` },
    { model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }
  );
  if (!res.ok) throw await apiError('OpenAI', res);
  for await (const { data } of sseEvents(res.body)) {
    if (data === '[DONE]') break;
    const j = parseJSON(data);
    if (!j) continue;
    if (j.error) throw new EngineError(msg('ai.providerError', { name: 'OpenAI', error: j.error.message || 'error' }), 'ai_failed');
    const text = j.choices?.[0]?.delta?.content;
    if (text) yield { type: 'delta', text };
    if (j.usage) yield { type: 'usage', input: j.usage.prompt_tokens, output: j.usage.completion_tokens, model: j.model || model };
  }
  yield { type: 'done' };
}

// ---------------------------------------------------------------- cloud (metered Edge Function)

async function* cloud({ prompt, system, step, project, locale, deep, model }) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetch(`${c.url}/functions/v1/ai-fix`, {
      method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt, system, step, project, locale, deep: !!deep, model: model || undefined }),
    });
  } catch (e) {
    throw new EngineError(msg('ai.network', { error: e.message }), 'network');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) || {};
    if (res.status === 402) throw new EngineError(msg('ai.quotaExhausted', { renewsAt: j.renewsAt || '—' }), 'quota_exhausted', 8);
    if (res.status === 403) throw new EngineError(msg(j.code === 'daily_cap' ? 'ai.dailyCap' : 'ai.unavailable.noPlan'), j.code === 'daily_cap' ? 'ai_daily_cap' : 'ai_unavailable');
    if (res.status === 429) throw new EngineError(msg('ai.rateLimited', { name: 'Before I Deploy AI' }), 'ai_rate_limited');
    if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
    throw new EngineError(msg('ai.providerHttp', { name: 'ai-fix', status: res.status, detail: j.error || '' }), 'ai_failed');
  }
  for await (const { data } of sseEvents(res.body)) {
    const j = parseJSON(data);
    if (!j) continue;
    if (j.type === 'error') throw new EngineError(msg('ai.providerError', { name: 'ai-fix', error: j.error || 'error' }), 'ai_failed');
    if (j.type === 'delta' || j.type === 'usage' || j.type === 'done') yield j;
    if (j.type === 'done') return;
  }
  yield { type: 'done' };
}

// ---------------------------------------------------------------- selection

export const OWN_KEY_PROVIDERS = ['anthropic', 'openai'];

/** The provider to use for this account: an explicit choice, else own key (anthropic, then openai), else cloud. */
export function chooseProvider({ features, requested }) {
  const own = OWN_KEY_PROVIDERS.filter((p) => !!ownKey(p));
  if (requested) {
    if (requested === 'cloud') {
      if (!features?.['ai.cloud']) throw new EngineError(msg('ai.unavailable.noPlan'), 'ai_unavailable');
      return 'cloud';
    }
    if (!OWN_KEY_PROVIDERS.includes(requested)) throw new EngineError(msg('ai.unknownProvider', { provider: requested }), 'usage', 2);
    if (!features?.['ai.ownKey']) throw new EngineError(msg('ai.unavailable.ownKeyRole'), 'ai_unavailable');
    if (!ownKey(requested)) throw new EngineError(msg('ai.unavailable.noKey', { provider: requested }), 'ai_unavailable');
    return requested;
  }
  if (features?.['ai.ownKey'] && own.length) return own[0];
  if (features?.['ai.cloud']) return 'cloud';
  if (features?.['ai.ownKey']) throw new EngineError(msg('ai.unavailable.noKey', { provider: 'anthropic' }), 'ai_unavailable');
  if (!features) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  throw new EngineError(msg('ai.unavailable.noPlan'), 'ai_unavailable');
}

export function stream(provider, params) {
  if (provider === 'anthropic') return anthropic({ ...params, key: ownKey('anthropic') });
  if (provider === 'openai') return openai({ ...params, key: ownKey('openai') });
  if (provider === 'cloud') return cloud(params);
  throw new EngineError(msg('ai.unknownProvider', { provider }), 'usage', 2);
}
