// Feature gates derived from the account's role and plan (V10 WP2). The backend is the source of truth
// for role/plan/credits; this module only turns them into yes/no answers the app can render.
//
// Owner decisions from V10-PLAN §5 live here as constants so they can be flipped in one place:
//   FREE_CLOUD_SYNC (decision 5: Free plan without cloud sync)   CLOUD_AI_PROVIDER (decision 3: Anthropic)
//   OWN_KEY_FOR_EVERYONE (owner decision 2026-09-30, docs/PLANS-AND-CREDITS-BG.md: false — Free, Flash, High and
//   Knight run on the owner's accounts through the cloud; VIP and admin bring their own keys)

export const FREE_CLOUD_SYNC = false;
export const OWN_KEY_FOR_EVERYONE = false;
export const CLOUD_AI_PROVIDER = 'anthropic';

export const ROLES = ['normal', 'vip', 'admin'];
export const PLANS = ['free', 'flash', 'high', 'knight'];
const PAID = ['flash', 'high', 'knight'];

/** Max projects per plan; null = unlimited. VIP/admin are unlimited. */
export const PROJECT_LIMITS = { free: 2, flash: 5, high: null, knight: null };

/** AI keys a VIP/admin can add in Setup → Keychain accounts `ai-<provider>`. */
export const AI_KEY_PROVIDERS = ['anthropic', 'openai'];

function normalize(account) {
  const role = ROLES.includes(account?.role) ? account.role : 'normal';
  const plan = PLANS.includes(account?.plan) ? account.plan : 'free';
  return { role, plan, aiDisabled: !!account?.aiDisabled, hasOwnKey: !!account?.hasOwnKey };
}

/** All gates at once — this is what `account status` returns as `features`. */
export function features(account) {
  const a = normalize(account);
  const privileged = a.role === 'vip' || a.role === 'admin';
  const paid = PAID.includes(a.plan);
  return {
    'ai.cloud': a.role === 'normal' && paid && !a.aiDisabled,   // central key, metered by the backend
    'ai.ownKey': privileged || OWN_KEY_FOR_EVERYONE,             // own Anthropic/OpenAI key from Keychain
    'ai.builtin': (a.role === 'normal' && paid && !a.aiDisabled) || (privileged && a.hasOwnKey),
    'ai.external': true,                                         // ChatGPT/Claude/Codex buttons — free for everyone
    'ai.deep': a.plan === 'knight' || privileged,
    'cloud.sync': privileged || paid || FREE_CLOUD_SYNC,
    'admin.panel': a.role === 'admin',
    'billing.plans': a.role === 'normal',                        // normal users see the plans / subscription
    'projects.max': privileged ? null : PROJECT_LIMITS[a.plan] ?? null,
  };
}

export function can(feature, account) {
  const f = features(account)[feature];
  return f === undefined ? false : f === null ? true : !!f;
}
