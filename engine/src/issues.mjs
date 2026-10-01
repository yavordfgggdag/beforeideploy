// Unified issues (V11): every check step result is turned into the same shape, so the app can show one
// prioritized list — what was found, the evidence, the impact, how sure we are, the proposed fix and its risk,
// and how the result is verified. Nothing here runs a tool; it only reads a check result.
//
//   { id, step, rule, severity, kind, confidence, title, impact, evidence: { file?, line?, resource?, detail?, log? },
//     fix: { type: 'safe' | 'ai' | 'ui' | 'manual', id?, risk } | null, verify: { steps: [] }, blocksRelease }
//
// severity: blocker (release stops) > high (broken functionality / security) > medium > low > info
// kind: defect (a tool proved it) · recommendation (better practice) · signal (heuristic hint, may be wrong)
// confidence: confirmed (tool output) · likely (derived) · heuristic (pattern)
import { t } from './i18n.mjs';

export const SEVERITIES = ['blocker', 'high', 'medium', 'low', 'info'];
const SEV_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i]));
const CONF_RANK = { confirmed: 0, likely: 1, heuristic: 2 };
const STEP_ORDER = ['build', 'secrets', 'deps', 'git', 'typecheck', 'lint', 'site', 'hosting'];

/** Which check steps prove a fix worked. */
export const FIX_VERIFIES = {
  'env.untrack': ['secrets', 'git'],
  'gitignore.env': ['secrets'],
  'gitignore.create': ['secrets'],
  'git.init': ['git'],
  'deps.install': ['deps', 'build'],
  'github.create': ['git'],
  'netlify.link': ['hosting'],
  'site.robots': ['site'],
  'site.sitemap': ['site'],
  'site.404': ['site'],
};

/** Site rules the AI can fix in the page source (the rest need a file the safe fix creates, or a human). */
const SITE_AI_RULES = new Set(['seo.title', 'seo.titleLength', 'seo.description', 'seo.lang', 'seo.canonical', 'seo.og', 'content.lorem', 'content.localhost', 'content.brokenLinks', 'content.mixedContent', 'a11y.imgAlt', 'a11y.inputLabel', 'a11y.buttonText', 'content.emptyHref', 'content.todo', 'seo.favicon']);
const SITE_SEVERITY = { fail: 'high', warn: 'medium', info: 'low' };
const SITE_KIND = { fail: 'defect', warn: 'recommendation', info: 'recommendation' };

/** Every rule's texts (kept literal so the catalog check can prove each key exists and is used). */
export const RULE_KEYS = [
  'issue.build.failed.impact',
  'issue.build.failed.title',
  'issue.build.noOutput.impact',
  'issue.build.noOutput.title',
  'issue.build.noSite.impact',
  'issue.build.noSite.title',
  'issue.deps.noNode.impact',
  'issue.deps.noNode.title',
  'issue.deps.notInstalled.impact',
  'issue.deps.notInstalled.title',
  'issue.deps.pmMissing.impact',
  'issue.deps.pmMissing.title',
  'issue.git.conflicts.impact',
  'issue.git.conflicts.title',
  'issue.git.missing.impact',
  'issue.git.missing.title',
  'issue.git.noRepo.impact',
  'issue.git.noRepo.title',
  'issue.git.uncommitted.impact',
  'issue.git.uncommitted.title',
  'issue.hosting.cliMissing.impact',
  'issue.hosting.cliMissing.title',
  'issue.hosting.notLinked.impact',
  'issue.hosting.notLinked.title',
  'issue.hosting.notLoggedIn.impact',
  'issue.hosting.notLoggedIn.title',
  'issue.hosting.unsupported.impact',
  'issue.hosting.unsupported.title',
  'issue.lint.failed.impact',
  'issue.lint.failed.title',
  'issue.lint.none.impact',
  'issue.lint.none.title',
  'issue.secrets.leaked.impact',
  'issue.secrets.leaked.title',
  'issue.secrets.trackedEnv.impact',
  'issue.secrets.trackedEnv.title',
  'issue.secrets.unignoredEnv.impact',
  'issue.secrets.unignoredEnv.title',
  'issue.typecheck.failed.impact',
  'issue.typecheck.failed.title',
  'issue.typecheck.none.impact',
  'issue.typecheck.none.title',
  'issue.site.seo.title.impact',
  'issue.site.seo.title.title',
  'issue.site.seo.titleLength.impact',
  'issue.site.seo.titleLength.title',
  'issue.site.seo.description.impact',
  'issue.site.seo.description.title',
  'issue.site.seo.lang.impact',
  'issue.site.seo.lang.title',
  'issue.site.seo.noindex.impact',
  'issue.site.seo.noindex.title',
  'issue.site.seo.canonical.impact',
  'issue.site.seo.canonical.title',
  'issue.site.seo.og.impact',
  'issue.site.seo.og.title',
  'issue.site.seo.robots.impact',
  'issue.site.seo.robots.title',
  'issue.site.seo.sitemap.impact',
  'issue.site.seo.sitemap.title',
  'issue.site.seo.favicon.impact',
  'issue.site.seo.favicon.title',
  'issue.site.content.lorem.impact',
  'issue.site.content.lorem.title',
  'issue.site.content.placeholderImage.impact',
  'issue.site.content.placeholderImage.title',
  'issue.site.content.localhost.impact',
  'issue.site.content.localhost.title',
  'issue.site.content.brokenLinks.impact',
  'issue.site.content.brokenLinks.title',
  'issue.site.content.mixedContent.impact',
  'issue.site.content.mixedContent.title',
  'issue.site.content.emptyHref.impact',
  'issue.site.content.emptyHref.title',
  'issue.site.content.todo.impact',
  'issue.site.content.todo.title',
  'issue.site.a11y.imgAlt.impact',
  'issue.site.a11y.imgAlt.title',
  'issue.site.a11y.inputLabel.impact',
  'issue.site.a11y.inputLabel.title',
  'issue.site.a11y.buttonText.impact',
  'issue.site.a11y.buttonText.title',
  'issue.site.assets.imageSize.impact',
  'issue.site.assets.imageSize.title',
  'issue.site.assets.pageSize.impact',
  'issue.site.assets.pageSize.title',
  'issue.site.structure.notFound.impact',
  'issue.site.structure.notFound.title',
];

function issue(step, rule, over) {
  const base = {
    id: `${step}.${rule}`,
    step,
    rule,
    severity: 'medium',
    kind: 'defect',
    confidence: 'confirmed',
    title: t(RULE_KEYS.includes(`issue.${step}.${rule}.title`) ? `issue.${step}.${rule}.title` : 'issue.generic.title', { step, rule }),
    impact: t(RULE_KEYS.includes(`issue.${step}.${rule}.impact`) ? `issue.${step}.${rule}.impact` : 'issue.generic.impact'),
    evidence: {},
    fix: null,
    verify: { steps: [step] },
  };
  const out = { ...base, ...over, evidence: { ...(over.evidence || {}) } };
  // a safe fix is verified by the steps that prove it, not only by the step that found the issue
  if (!over.verify && out.fix?.type === 'safe' && FIX_VERIFIES[out.fix.id]) out.verify = { steps: FIX_VERIFIES[out.fix.id] };
  out.blocksRelease = out.severity === 'blocker';
  return out;
}

const safeFix = (id, risk = 'low') => ({ type: 'safe', id, risk });
const aiFix = (step) => ({ type: 'ai', id: step, risk: 'medium' });
const uiFix = (id) => ({ type: 'ui', id, risk: 'low' });
const manual = () => ({ type: 'manual', risk: 'low' });

function fromStep(s, ctx) {
  const out = [];
  const log = s.log || undefined;
  const details = s.details || [];
  switch (s.id) {
    case 'git':
      if (s.status === 'fail') out.push(issue('git', 'conflicts', { severity: 'blocker', evidence: { detail: details.join('\n') }, fix: manual() }));
      else if (s.status === 'warn' && ctx.gitInstalled === false) out.push(issue('git', 'missing', { severity: 'high', kind: 'recommendation', fix: manual() }));
      else if (s.status === 'warn') out.push(issue('git', 'uncommitted', { severity: 'low', kind: 'recommendation', evidence: { detail: details.filter((d) => /^[ MADRCU?!]{1,2} /.test(d)).join('\n') }, fix: uiFix('commit') }));
      else if (s.status === 'info') out.push(issue('git', 'noRepo', { severity: 'medium', kind: 'recommendation', fix: safeFix('git.init') }));
      break;
    case 'secrets': {
      for (const f of s.findings || []) {
        if (f.type === 'secret') out.push(issue('secrets', 'leaked', { id: `secrets.leaked:${f.file}:${f.line}`, severity: 'blocker', evidence: { file: f.file, line: f.line, detail: `${f.kind} (${f.sample})` }, fix: manual(), verify: { steps: ['secrets'] } }));
        else if (f.type === 'tracked-env') out.push(issue('secrets', 'trackedEnv', { id: `secrets.trackedEnv:${f.file}`, severity: 'blocker', evidence: { file: f.file }, fix: safeFix('env.untrack', 'medium') }));
        else if (f.type === 'unignored-env') out.push(issue('secrets', 'unignoredEnv', { id: `secrets.unignoredEnv:${f.file}`, severity: 'high', kind: 'recommendation', evidence: { file: f.file }, fix: safeFix(ctx.hasGitignore ? 'gitignore.env' : 'gitignore.create') }));
      }
      break;
    }
    case 'deps':
      if (s.status === 'fail' && /Node/i.test(s.summary || '') && !details.length) out.push(issue('deps', 'noNode', { severity: 'blocker', fix: manual() }));
      else if (s.status === 'fail' && s.fixes?.includes('deps.install')) out.push(issue('deps', 'notInstalled', { severity: 'blocker', evidence: { detail: details.join('\n') }, fix: safeFix('deps.install'), verify: { steps: ['deps', 'build'] } }));
      else if (s.status === 'warn' && s.fixes?.includes('deps.install')) out.push(issue('deps', 'notInstalled', { severity: 'medium', kind: 'recommendation', fix: safeFix('deps.install') }));
      else if (s.status === 'fail') out.push(issue('deps', 'pmMissing', { severity: 'blocker', evidence: { detail: s.summary }, fix: manual() }));
      break;
    case 'lint':
    case 'typecheck':
      if (s.status === 'fail') out.push(issue(s.id, 'failed', { severity: s.id === 'typecheck' ? 'high' : 'medium', evidence: { detail: details.slice(-12).join('\n'), log }, fix: aiFix(s.id) }));
      else if (s.status === 'info') out.push(issue(s.id, 'none', { severity: 'low', kind: 'recommendation', confidence: 'likely', fix: manual() }));
      break;
    case 'build':
      if (s.status === 'fail') out.push(issue('build', 'failed', { severity: 'blocker', evidence: { detail: details.slice(-12).join('\n'), log }, fix: aiFix('build') }));
      else if (s.status === 'warn') out.push(issue('build', 'noOutput', { severity: 'high', evidence: { detail: s.summary, log }, fix: aiFix('build') }));
      else if (s.status === 'info') out.push(issue('build', 'noSite', { severity: 'medium', kind: 'signal', confidence: 'heuristic', fix: manual() }));
      break;
    case 'site':
      for (const f of s.findings || []) {
        // a page that must not be indexed on production blocks the release like a broken build would
        const severity = f.rule === 'seo.noindex' ? 'blocker' : f.rule === 'content.lorem' || f.rule === 'content.localhost' ? (f.severity === 'fail' ? 'high' : SITE_SEVERITY[f.severity]) : SITE_SEVERITY[f.severity] || 'medium';
        out.push(
          issue('site', f.rule, {
            id: `site.${f.rule}${f.file ? `:${f.file}` : ''}${f.line ? `:${f.line}` : ''}`,
            severity,
            kind: SITE_KIND[f.severity] || 'recommendation',
            confidence: f.rule.startsWith('content.') || f.rule.startsWith('seo.') ? 'confirmed' : 'likely',
            evidence: { file: f.file, line: f.line, detail: f.detail },
            fix: f.fixId ? safeFix(f.fixId) : SITE_AI_RULES.has(f.rule) ? aiFix('site') : manual(),
            verify: { steps: ['site'] },
          })
        );
      }
      break;
    case 'hosting':
      if (s.status === 'fail') out.push(issue('hosting', 'unsupported', { severity: 'blocker', evidence: { detail: s.summary }, fix: uiFix('hosting-chooser') }));
      else if (s.status === 'warn' && /not (logged|signed)/i.test(s.summary || '') || (s.status === 'warn' && ctx.hostingLoggedIn === false)) out.push(issue('hosting', 'notLoggedIn', { severity: 'medium', kind: 'recommendation', fix: uiFix('setup') }));
      else if (s.status === 'warn') out.push(issue('hosting', 'cliMissing', { severity: 'medium', kind: 'recommendation', fix: uiFix('setup') }));
      else if (s.status === 'info') out.push(issue('hosting', 'notLinked', { severity: 'medium', kind: 'recommendation', fix: uiFix('netlify-setup') }));
      break;
    default:
      if (s.status === 'fail') out.push(issue(s.id, 'failed', { severity: 'high', evidence: { detail: details.join('\n'), log }, fix: manual(), title: s.summary || s.id, impact: '' }));
  }
  return out;
}

export function sortIssues(list) {
  return [...list].sort(
    (a, b) =>
      (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9) ||
      (CONF_RANK[a.confidence] ?? 9) - (CONF_RANK[b.confidence] ?? 9) ||
      (STEP_ORDER.indexOf(a.step) + 99) % 99 - (STEP_ORDER.indexOf(b.step) + 99) % 99
  );
}

/**
 * Issues from a stored check result. `ctx` carries facts the step summaries do not: whether git / the hosting
 * CLI is installed, whether there is a .gitignore.
 */
export function deriveIssues(check, ctx = {}) {
  if (!check?.steps) return { issues: [], counts: countIssues([]), checkedAt: null, partial: false };
  const issues = sortIssues(check.steps.flatMap((s) => fromStep(s, ctx)));
  return { issues, counts: countIssues(issues), checkedAt: check.at || null, partial: !!check.partial };
}

export function countIssues(issues) {
  const counts = { total: issues.length, blocker: 0, high: 0, medium: 0, low: 0, info: 0, defects: 0, recommendations: 0, signals: 0 };
  for (const i of issues) {
    counts[i.severity] = (counts[i.severity] || 0) + 1;
    if (i.kind === 'defect') counts.defects++;
    else if (i.kind === 'recommendation') counts.recommendations++;
    else counts.signals++;
  }
  return counts;
}

/** After a fix: which of the issues it targeted are gone, which remain. */
export function compareIssues(before, after, targetIds) {
  const afterIds = new Set(after.map((i) => i.id));
  const targeted = before.filter((i) => targetIds.has(i.id));
  const resolved = targeted.filter((i) => !afterIds.has(i.id)).map((i) => i.id);
  const unresolved = targeted.filter((i) => afterIds.has(i.id)).map((i) => i.id);
  return { resolved, unresolved, verified: targeted.length > 0 && unresolved.length === 0 };
}
