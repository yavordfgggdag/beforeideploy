// Site Builder v2, step 1 — `bid site chat`: the owner starts a site with ONE message; the assistant either asks
// what it still needs (short questions with option chips, at most two rounds) or hands back a brief the existing
// pipeline (`bid new content` / `bid new generate`) builds from. The model never writes HTML: it answers in
// JSON, the engine validates every field (theme from the shipped list, brief through normalizeBrief).
import { EngineError } from '../util.mjs';
import { msg, currentLang } from '../i18n.mjs';
import { listThemes, suggestThemes } from './themes.mjs';
import { normalizeBrief, BRIEF_SCHEMA } from './brief.mjs';
import { TONES } from './ai.mjs';

export const MAX_ROUNDS = 2; // question rounds before the assistant must build with what it has
export const MAX_QUESTIONS = 3;
export const CHAT_MAX_TOKENS = 1800;

/**
 * Model choice. `auto` = a cheap fast model for the conversation (it only asks and summarises); an explicit id
 * is passed through untouched. Heavier tiers matter for the content step, not for this one.
 */
export const AUTO_MODEL = 'claude-haiku-4-5';
export const routeModel = (choice) => (!choice || choice === 'auto' ? AUTO_MODEL : String(choice));

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export const CHAT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'say', 'questions', 'brief'],
  properties: {
    action: { type: 'string', enum: ['ask', 'build'] },
    say: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'options'],
        properties: { id: { type: 'string' }, text: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      },
    },
    brief: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'theme', 'description', 'offer', 'audience', 'services', 'tone', 'city'],
      properties: {
        name: { type: 'string' },
        theme: { type: 'string' },
        description: { type: 'string' },
        offer: { type: 'string' },
        audience: { type: 'string' },
        services: { type: 'array', items: { type: 'string' } },
        tone: { type: 'string' },
        city: { type: 'string' },
      },
    },
  },
};

export const CHAT_SYSTEM = `You are the site-building assistant inside Before I Deploy. A small-business owner who is not a designer or programmer starts a website with one message. Your job is to learn what you need, then hand over a brief.

Rules:
- Ask only what changes the site: what the business or project is, who it is for, what a visitor should do (call, book, buy, write), the name if it was not given, the city if customers come to a place. Skip anything the owner already said.
- At most ${MAX_QUESTIONS} questions per turn, each with 2–5 short answer options the owner can tap (they can always type their own). Never ask for contact details, prices or facts you would have to invent; the owner adds those later in the editor.
- Ask in at most ${MAX_ROUNDS} rounds in total. If the owner's first message is already clear enough, build at once. When you have the kind of site and its name (or can use a neutral working name), build.
- Answer in the owner's language. Plain words, no jargon, no hype, no emoji.
- Never invent facts: no years in business, numbers, awards, customers, certificates, prices or addresses. Services are names only, taken from what the owner said.
- "theme" must be one id from the list you are given; pick the closest kind of site.
- "say": one or two friendly sentences — when asking, why; when building, what you are about to make.
Return JSON only.`;

const themeLine = (th) => `${th.id}: ${clean(th.title, 40)} — ${clean(th.description, 90)}`;

/** The prompt for one turn: the shipped themes, how many question rounds are used, the whole conversation. */
export function chatPrompt(messages, { lang = currentLang(), asked = 0 } = {}) {
  const themes = listThemes();
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const hint = suggestThemes(last, { limit: 3 }).map((s) => s.id).filter(Boolean);
  const left = Math.max(0, MAX_ROUNDS - asked);
  return [
    `Owner's language: ${lang}.`,
    `Question rounds already used: ${asked} of ${MAX_ROUNDS}. ${left === 0 ? 'You must build now (action "build").' : 'You may ask once more, only if something essential is missing.'}`,
    hint.length ? `Closest themes by keywords: ${hint.join(', ')}.` : '',
    'Available themes (id: title — description):',
    themes.map(themeLine).join('\n'),
    '',
    'Conversation:',
    ...messages.map((m) => `${m.role === 'user' ? 'Owner' : 'You'}: ${clean(m.content, 1500)}`),
    '',
    'Return {action, say, questions, brief}. For "ask": 1–3 questions and an empty-ish brief. For "build": questions = [] and the brief filled from the conversation (unknown text fields as empty strings).',
  ].filter(Boolean).join('\n');
}

/** What a model answered, as safe data: the action, the words, the questions, the brief — or throws ai_bad_answer. */
export function readAnswer(json, { asked = 0, lastUser = '' } = {}) {
  if (!json || typeof json !== 'object') throw Object.assign(new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed'), { code: 'ai_bad_answer' });
  const say = clean(json.say, 400);
  let action = json.action === 'ask' ? 'ask' : 'build';
  const questions = (Array.isArray(json.questions) ? json.questions : [])
    .map((q, i) => ({
      id: clean(q?.id, 30).replace(/[^\w-]/g, '') || `q${i + 1}`,
      text: clean(q?.text, 200),
      options: (Array.isArray(q?.options) ? q.options : []).map((o) => clean(o, 60)).filter(Boolean).slice(0, 5),
    }))
    .filter((q) => q.text)
    .slice(0, MAX_QUESTIONS);
  // no more rounds, or nothing to ask: build with what there is
  if (asked >= MAX_ROUNDS || (action === 'ask' && !questions.length)) action = 'build';
  if (action === 'ask') return { action, say, questions };

  const b = json.brief && typeof json.brief === 'object' ? json.brief : {};
  const ids = new Set(listThemes().map((th) => th.id));
  let theme = ids.has(b.theme) ? b.theme : null;
  if (!theme) theme = suggestThemes(`${b.description || ''} ${b.offer || ''} ${lastUser}`, { limit: 1 })[0]?.id || 'landing';
  const tone = TONES.includes(b.tone) ? b.tone : null;
  const city = clean(b.city, 60);
  const brief = normalizeBrief({
    name: clean(b.name, 80) || clean(lastUser, 40) || 'My site',
    theme,
    lang: currentLang(),
    description: clean(b.description, 300),
    offer: [clean(b.offer, 900), city ? `City: ${city}` : ''].filter(Boolean).join('\n'),
    audience: clean(b.audience, 200),
    services: (Array.isArray(b.services) ? b.services : []).map((s) => clean(s, 80)).filter(Boolean).slice(0, 8),
    tone,
    contacts: {}, // never from the model: the owner adds real contact details
  });
  return { action: 'build', say, brief, schema: BRIEF_SCHEMA };
}

/** One conversation turn. `call` is the same function the pipeline uses ({ model, system, prompt, schema, ... } → { json, usage }). */
export async function chatTurn({ messages, call, model = 'auto', asked = 0, lang }) {
  const list = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20);
  const lastUser = [...list].reverse().find((m) => m.role === 'user')?.content || '';
  if (!lastUser.trim()) throw new EngineError(msg('newsite.missingBrief'), 'usage', 2);
  const chosen = routeModel(model);
  const r = await call({ step: 'chat', model: chosen, system: CHAT_SYSTEM, prompt: chatPrompt(list, { lang, asked }), schema: CHAT_SCHEMA, maxTokens: CHAT_MAX_TOKENS, effort: 'low' });
  return { ...readAnswer(r.json, { asked, lastUser }), model: r.usage?.model || chosen, usage: r.usage || null };
}
