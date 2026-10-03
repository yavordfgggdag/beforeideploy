// Builder phase 2 — talk to a site: three modes on one conversation per project.
//   chat   discuss the site; answers and ideas, never touches a file
//   plan   a short, editable list of steps in plain words; nothing is changed
//   build  applies the (edited) plan or a request to the real site: the existing edit pipeline (a model turns the
//          words into a few validated operations; every change is one Git commit with Undo; hand-edited
//          files are never overwritten silently)
// The conversation is kept per project (redacted, capped) so the editor shows it again after a restart.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, EngineError } from '../util.mjs';
import { msg, currentLang } from '../i18n.mjs';
import { accountStatus } from '../account.mjs';
import { chooseProvider } from '../ai/providers.mjs';
import { recordCost } from '../costs.mjs';
import { appendHistory, assistantHistory } from '../ai/conversation.mjs';
import { redact } from '../aifix.mjs';
import { siteRecord, editSite } from './edit.mjs';
import { aiTheme, loadTheme } from './themes.mjs';
import { recipeText, briefText, SYSTEM } from './ai.mjs';
import { providerCall } from './aicontent.mjs';

export const MODES = ['chat', 'plan', 'build'];
export const MAX_STEPS = 6;
export const BUILD_MAX_CHARS = 1500;
const HISTORY_FOR_PROMPT = 10;
const usageOf = (u) => (u ? { input: u.input ?? null, output: u.output ?? null, charged: u.charged ?? null, model: u.model ?? null } : null);

const key = (project) => `site-${String(project.key).replace(/[^\w-]/g, '')}`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------------------------------------------------------------- standing instructions (per project)

const instructionsFile = (project) => path.join(APP_DIR, 'chats', `${key(project)}.instructions.txt`);
export function readInstructions(project) {
  try { return fs.readFileSync(instructionsFile(project), 'utf8').slice(0, 2000); } catch { return ''; }
}
export function writeInstructions(project, text) {
  const body = redact(clean(text, 2000));
  fs.mkdirSync(path.dirname(instructionsFile(project)), { recursive: true, mode: 0o700 });
  if (!body) fs.rmSync(instructionsFile(project), { force: true });
  else fs.writeFileSync(instructionsFile(project), body + '\n', { mode: 0o600 });
  return body;
}

// ---------------------------------------------------------------- history

export function talkHistory(project, { limit = 60 } = {}) {
  const h = assistantHistory({ key: key(project) }, { limit });
  return { entries: h.entries, hasMore: h.hasMore, instructions: readInstructions(project) };
}

// ---------------------------------------------------------------- prompts and answers

export const TALK_SYSTEM = `${SYSTEM}

You are talking with the owner about THEIR website inside Before I Deploy. You can see the site's structure and texts below. You can only change a site's words, sections, colours and style — not code, forms, payments or databases; say so plainly when something is outside that. Never invent facts about the business. Answer in the owner's language, in plain words, short.`;

export const CHAT_SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'next'], properties: { reply: { type: 'string' }, next: { type: 'array', items: { type: 'string' } } } };
export const PLAN_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'steps'], properties: { summary: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } } };

function context(project, record) {
  const theme = loadTheme(record.theme);
  const brief = { ...record.brief, ...(theme ? aiTheme(theme) : {}) };
  const past = talkHistory(project, { limit: HISTORY_FOR_PROMPT }).entries
    .map((e) => `${e.role === 'user' ? 'Owner' : 'You'}: ${clean(e.text, 400)}`)
    .join('\n');
  const rules = readInstructions(project);
  return [
    briefText(brief),
    rules ? `Standing instructions from the owner (always follow them):\n${rules}` : '',
    `The site today:\n${recipeText(record.content)}`,
    past ? `Conversation so far:\n${past}` : '',
  ].filter(Boolean).join('\n\n');
}

export function chatPrompt(ctx, say) {
  return `${ctx}\n\nThe owner says: "${clean(say, 800)}"\n\nAnswer as a helpful site advisor. You are in DISCUSSION mode: you do not change anything. If the owner asks for a change, explain what you would do and tell them to press Plan or Build. "next": up to 3 short follow-up requests the owner could send (in their language, as they would write them).`;
}
export function planPrompt(ctx, say) {
  return `${ctx}\n\nThe owner wants: "${clean(say, 800)}"\n\nWrite a plan: "summary" (one sentence) and 1–${MAX_STEPS} "steps", each one concrete change to the site in the owner's own words (for example: "Change the title of the home page to …", "Add a price list after the services", "Remove the reviews section", "Make the colours calmer"). Only changes to words, sections, colours and style are possible. Do not invent facts or prices.`;
}

export function readPlan(json) {
  if (!json || typeof json !== 'object') throw Object.assign(new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed'), { code: 'ai_bad_answer' });
  const steps = (Array.isArray(json.steps) ? json.steps : []).map((s) => clean(typeof s === 'string' ? s : s?.text, 240)).filter(Boolean).slice(0, MAX_STEPS);
  if (!steps.length) throw Object.assign(new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed'), { code: 'ai_bad_answer' });
  return { summary: clean(json.summary, 240), steps };
}

/** The words a build is made from: the edited plan steps, one per line, or the owner's own request. */
export function buildWords({ plan, say }) {
  if (Array.isArray(plan) && plan.length) return plan.map((s) => clean(s, 240)).filter(Boolean).slice(0, MAX_STEPS).map((s, i) => `${i + 1}. ${s}`).join(' ');
  return clean(say, BUILD_MAX_CHARS);
}

/** Auto: a cheap model to talk, a stronger one to plan; an explicit pick is kept. */
export const talkModel = (choice, mode) => (choice && choice !== 'auto' ? String(choice) : mode === 'plan' ? 'claude-sonnet-5-5' : 'claude-haiku-4-5');

// ---------------------------------------------------------------- one turn

export async function talkTurn(project, { mode, say, plan = null, model = 'auto', provider: requested = null, force = false, call = null }) {
  if (!MODES.includes(mode)) throw new EngineError(msg('site.edit.missingSay'), 'usage', 2);
  const record = siteRecord(project.path);
  if (!record) throw new EngineError(msg('site.edit.notGenerated'), 'not_generated');
  const words = mode === 'build' ? buildWords({ plan, say }) : clean(say, 800);
  if (!words) throw new EngineError(msg('site.edit.missingSay'), 'usage', 2);
  const at = () => new Date().toISOString();
  const k = key(project);

  if (mode === 'build') {
    appendHistory(k, { at: at(), role: 'user', kind: 'build', mode, text: words });
    let r;
    try {
      r = await editSite(project, { say: words, provider: requested, force, maxChars: BUILD_MAX_CHARS });
    } catch (e) {
      appendHistory(k, { at: at(), role: 'assistant', kind: 'error', mode, text: e.message, code: e.code || null });
      throw e;
    }
    const text = r.summary || `${r.applied.length}`;
    appendHistory(k, { at: at(), role: 'assistant', kind: 'build', mode, text, build: { applied: r.applied, refused: r.refused, changed: r.changed, commit: r.commit || null, usage: usageOf(r.usage) } });
    return { mode, summary: r.summary, applied: r.applied, refused: r.refused, changed: r.changed, commit: r.commit || null, usage: r.usage || null, provider: r.provider };
  }

  // chat and plan: a model answers, nothing on disk changes
  let provider = requested;
  let run = call;
  if (!run) {
    const status = await accountStatus();
    provider = chooseProvider({ features: status.features || null, requested });
    run = providerCall(provider);
  }
  const ctx = context(project, record);
  const step = mode === 'plan' ? 'plan' : 'chat';
  appendHistory(k, { at: at(), role: 'user', kind: mode, mode, text: words });
  const r = await run({ step, model: talkModel(model, mode), system: TALK_SYSTEM, prompt: mode === 'plan' ? planPrompt(ctx, words) : chatPrompt(ctx, words), schema: mode === 'plan' ? PLAN_SCHEMA : CHAT_SCHEMA, maxTokens: mode === 'plan' ? 1500 : 1200, effort: 'low' });
  const usage = r.usage || null;
  if (usage) {
    const amount = usage.charged ?? (usage.input || 0) + (usage.output || 0);
    recordCost({ project: project.key, projectName: project.name, service: provider === 'cloud' ? 'ai-cloud' : `ai-${provider}`, op: `site.${step}`, amount, unit: usage.charged != null ? 'credits' : 'tokens', estimated: false, ref: usage.model || null });
  }
  if (mode === 'plan') {
    const p = readPlan(r.json);
    appendHistory(k, { at: at(), role: 'assistant', kind: 'plan', mode, text: p.summary, plan: p, usage: usageOf(usage) });
    return { mode, plan: p, usage, model: usage?.model || null };
  }
  const reply = clean(r.json?.reply, 1500);
  if (!reply) throw Object.assign(new EngineError(msg('newsite.ai.badAnswer'), 'ai_failed'), { code: 'ai_bad_answer' });
  const next = (Array.isArray(r.json?.next) ? r.json.next : []).map((s) => clean(s, 120)).filter(Boolean).slice(0, 3);
  appendHistory(k, { at: at(), role: 'assistant', kind: 'chat', mode, text: reply, next, usage: usageOf(usage) });
  return { mode, reply, next, usage, model: usage?.model || null };
}
