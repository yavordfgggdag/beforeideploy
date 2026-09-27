// Own AI API keys for VIP/admin accounts (V10 WP2). Stored only in the macOS Keychain (accounts
// `ai-anthropic`, `ai-openai`); verified with one cheap request before being saved. The key itself is
// never written to files, logs or the cloud — `status` returns only a masked hint.
import { EngineError } from './util.mjs';
import { getSecret, setSecret, deleteSecret } from './secrets.mjs';
import { msg } from './i18n.mjs';
import { AI_KEY_PROVIDERS } from './features.mjs';

// Base URLs are overridable for tests (BID_ANTHROPIC_API / BID_OPENAI_API).
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    base: () => process.env.BID_ANTHROPIC_API || 'https://api.anthropic.com',
    prefix: 'sk-ant-',
    verify: async (base, key) =>
      fetch(`${base}/v1/models?limit=1`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } }),
    console: 'https://console.anthropic.com/settings/keys',
  },
  openai: {
    name: 'OpenAI',
    base: () => process.env.BID_OPENAI_API || 'https://api.openai.com',
    prefix: 'sk-',
    verify: async (base, key) => fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key}` } }),
    console: 'https://platform.openai.com/api-keys',
  },
};

function provider(id) {
  if (!AI_KEY_PROVIDERS.includes(id) || !PROVIDERS[id]) throw new EngineError(msg('aikeys.unknownProvider', { provider: id }), 'usage', 2);
  return PROVIDERS[id];
}

const mask = (k) => (k.length <= 12 ? '••••' : `${k.slice(0, 7)}…${k.slice(-4)}`);

export function aiKeysStatus() {
  return AI_KEY_PROVIDERS.map((id) => {
    const p = PROVIDERS[id];
    const s = getSecret(`ai-${id}`);
    return { provider: id, name: p.name, connected: !!s?.key, hint: s?.key ? mask(s.key) : null, savedAt: s?.savedAt || null, console: p.console };
  });
}

/** Verifies and stores a key. The key comes via env BID_AI_KEY (never as a CLI argument — `ps` would show it). */
export async function aiKeySet(id, key = process.env.BID_AI_KEY) {
  const p = provider(id);
  key = String(key || '').trim();
  if (!key) throw new EngineError(msg('aikeys.missingKey'), 'usage', 2);
  let res;
  try {
    res = await p.verify(p.base(), key);
  } catch (e) {
    throw new EngineError(msg('aikeys.network', { name: p.name, error: e.message }), 'network');
  }
  if (res.status === 401 || res.status === 403) throw new EngineError(msg('aikeys.rejected', { name: p.name }), 'unauthorized');
  if (!res.ok) throw new EngineError(msg('aikeys.http', { name: p.name, status: res.status }), 'aikey_failed');
  setSecret(`ai-${id}`, { key, savedAt: new Date().toISOString() });
  return { provider: id, connected: true, hint: mask(key) };
}

export function aiKeyDelete(id) {
  provider(id);
  deleteSecret(`ai-${id}`);
  return { provider: id, connected: false };
}

/** For engine modules that call the model (WP3): the stored key or null. */
export function ownKey(id) {
  return getSecret(`ai-${id}`)?.key || null;
}
