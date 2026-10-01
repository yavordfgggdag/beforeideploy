// AI providers (V10 WP3). Three ways to reach a model, one event stream:
//   anthropic / openai — the user's own key from the Keychain (VIP / admin)
//   cloud              — the metered `ai-fix` Edge Function (normal users with a plan; the central key never leaves the backend)
// Every provider yields { type: 'delta', text } · { type: 'usage', input?, output?, model? } · { type: 'done', stopReason? }.
import { testEndpoint } from '../isolation.mjs';
import { EngineError, fetchT } from '../util.mjs';
import { msg } from '../i18n.mjs';
import { ownKey } from '../aikeys.mjs';
import { cloudConfig, currentSession } from '../account.mjs';

// Base URLs are overridable for tests (the test suite runs fake endpoints on 127.0.0.1).
export const ANTHROPIC_API = () => testEndpoint('BID_ANTHROPIC_API') || 'https://api.anthropic.com';
export const OPENAI_API = () => testEndpoint('BID_OPENAI_API') || 'https://api.openai.com';

// ---------------------------------------------------------------- SSE

/** Turns a text/event-stream body into { event, data } objects (multi-line data joined with \n). */
export async function* sseEvents(body, { abort = null, idleMs = Number(process.env.BID_AI_IDLE_MS) || 120000 } = {}) {
  const decoder = new TextDecoder();
  let buf = '';
  // a stream that stops sending is cut after idleMs without a byte (WP02) — never an endless wait
  let idle = false;
  let timer = null;
  const arm = () => {
    clearTimeout(timer);
    if (abort) timer = setTimeout(() => { idle = true; abort.abort(); }, idleMs);
  };
  arm();
  const parse = (raw) => {
    let event = 'message';
    const data = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  try {
  for await (const chunk of body) {
    arm();
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const ev = parse(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
      if (ev) yield ev;
    }
  }
  } catch (e) {
    if (idle) throw new EngineError(msg('ai.streamIdle', { seconds: Math.round(idleMs / 1000) }), 'ai_timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const last = parse(buf);
  if (last) yield last;
}

async function post(url, headers, body, signal) {
  try {
    // the deadline covers the connection and the response headers; the body has its own idle timeout
    return await fetchT(url, { signal, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers }, body: JSON.stringify(body) }, Number(process.env.BID_AI_CONNECT_MS) || 60000);
  } catch (e) {
    if (e.code === 'ETIMEDOUT') throw new EngineError(msg('ai.streamIdle', { seconds: Math.round((Number(process.env.BID_AI_CONNECT_MS) || 60000) / 1000) }), 'ai_timeout');
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

async function* anthropic({ key, model, system, messages, maxTokens = 8000, effort = 'medium', signal, idleMs }) {
  const body = { model, max_tokens: maxTokens, system, messages, stream: true };
  // effort is not accepted by the Haiku 4.5 family; the other current models take it in output_config and run
  // adaptive thinking on their own (Opus 5.5 cannot switch it off — effort is the only depth control)
  if (effort && !/haiku/i.test(model)) body.output_config = { effort };
  const base = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  // A declined request is re-run server-side on Anthropic's recommended fallback model (beta).
  let res = await post(`${ANTHROPIC_API()}/v1/messages`, { ...base, 'anthropic-beta': 'server-side-fallback-2026-07-01' }, { ...body, fallbacks: 'default' }, signal);
  if (res.status === 400) {
    const text = await res.text().catch(() => '');
    if (/fallback/i.test(text)) res = await post(`${ANTHROPIC_API()}/v1/messages`, base, body, signal); // account without the beta
    else throw await apiError('Anthropic', new Response(text, { status: 400 }));
  }
  if (!res.ok) throw await apiError('Anthropic', res);
  let gotText = false;
  for await (const { data } of sseEvents(res.body, { abort: res.abortController, ...(idleMs ? { idleMs } : {}) })) {
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

async function* openai({ key, model, system, messages, maxTokens = 8000, signal, idleMs }) {
  const res = await post(
    `${OPENAI_API()}/v1/chat/completions`,
    { Authorization: `Bearer ${key}` },
    { model, stream: true, stream_options: { include_usage: true }, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, ...messages] }, signal
  );
  if (!res.ok) throw await apiError('OpenAI', res);
  for await (const { data } of sseEvents(res.body, { abort: res.abortController, ...(idleMs ? { idleMs } : {}) })) {
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

async function* cloud({ prompt, system, step, project, locale, deep, model, mode, operationId, signal, idleMs }) {
  const c = cloudConfig();
  if (!c) throw new EngineError(msg('account.cloud.notConfigured'), 'not_configured', 7);
  const s = await currentSession();
  if (!s) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
  let res;
  try {
    res = await fetchT(`${c.url}/functions/v1/ai-fix`, {
      signal, method: 'POST',
      headers: { apikey: c.anonKey, Authorization: `Bearer ${s.accessToken}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ prompt, system, step, project, locale, mode, operationId, deep: !!deep, model: model || undefined }),
    }, Number(process.env.BID_AI_CONNECT_MS) || 60000);
  } catch (e) {
    if (e.code === 'ETIMEDOUT') throw new EngineError(msg('ai.streamIdle', { seconds: Math.round((Number(process.env.BID_AI_CONNECT_MS) || 60000) / 1000) }), 'ai_timeout');
    throw new EngineError(msg('ai.network', { error: e.message }), 'network');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) || {};
    if (res.status === 404 && j.code === 'NOT_FOUND') throw new EngineError(msg('cloud.functionMissing', { name: 'ai-fix' }), 'cloud_function_missing');
    if (res.status === 402) throw new EngineError(msg('ai.quotaExhausted', { renewsAt: j.renewsAt || '—' }), 'quota_exhausted', 8);
    if (res.status === 403 && ['session_cap','window_5h'].includes(j.code)) throw new EngineError(msg('ai.sessionCap', { at: j.resetsAt ? new Date(j.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—', hours: j.windowHours || 5 }), 'ai_session_cap');
    if (res.status === 403 && j.code === 'window_week') throw new EngineError(msg('ai.weeklyCap', { at: j.resetsAt ? new Date(j.resetsAt).toLocaleString() : '—' }), 'window_week');
    if (j.code === 'meter_unavailable') throw new EngineError(msg('billing.meterUnavailable'), 'meter_unavailable');
    if (res.status === 403) throw new EngineError(msg('ai.unavailable.noPlan'), 'ai_unavailable');
    if (res.status === 429) throw new EngineError(msg('ai.rateLimited', { name: 'Before I Deploy AI' }), 'ai_rate_limited');
    if (res.status === 401) throw new EngineError(msg('account.notLoggedIn'), 'not_logged_in', 5);
    throw new EngineError(msg('ai.providerHttp', { name: 'ai-fix', status: res.status, detail: j.error || '' }), 'ai_failed');
  }
  for await (const { data } of sseEvents(res.body, { abort: res.abortController, ...(idleMs ? { idleMs } : {}) })) {
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
