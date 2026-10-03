#!/usr/bin/env node
import './platform/boot.mjs'; // first: PATH and locale for every OS (platform/index.mjs)
import { discardConversationPatch } from './ai/conversation.mjs';
import { gitAvailable } from './setup-tools.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Before I Deploy V6 — engine entrypoint. Every command prints NDJSON; the last line is {"type":"result",...}.
import { parseArgs, ok, fail, ev, emit, sh, which, EngineError, APP_DIR, CACHE_DIR, ENGINE_DIR, ensureDir, exitAfterFlush, readJSON } from './util.mjs';
import { detect } from './detect.mjs';
import { listProjects, upsertProject, removeProject, resolveProject, updateProject, getState, listHistory, findProject } from './store.mjs';
import { runChecks } from './checks.mjs';
import { deriveIssues } from './issues.mjs';
import { pushoverConnect, pushoverDisconnect, pushoverStatus } from './pushover.mjs';
import { endpoints, isProductionBundle, isolationLevel } from './isolation.mjs';
import { secretsBackend } from './secrets.mjs';
import { monitorOnce, monitorStatus, monitorStatusMerged, listIncidents, setMonitorSettings, agentInstall, agentRemove, maintenanceCommand, notifyTest } from './monitor.mjs';
import { monitorCloudStatus, monitorCloudEnable, monitorCloudDisable, monitorCloudTest } from './monitor-cloud.mjs';
import { assistantChat, assistantHistory, assistantReset, assistantSettings, setAssistantSettings, listPrompts } from './ai/assistant.mjs';
import { backupStatus } from './providers/backup/codeguard.mjs';
import { releasePreview, releasePromote, releaseStatus, releaseRollback, releaseCancel, capabilities } from './release.mjs';
import { localStart, localStop, localRestart, localStatus } from './local.mjs';
import { gitStatus, gitFetch, gitCommit, gitPush, gitSetRemote } from './git.mjs';
import { netlifyAuth, netlifyLogin, netlifyTeams, netlifySites, netlifyInfo, netlifyLink, netlifyCreate, netlifyDeploy } from './netlify.mjs';
import { listFixes, applyFix } from './fixes.mjs';
import { aifix } from './aifix.mjs';
import { costSummary, providerUsage, setBudgets, getPrices } from './costs.mjs';
import { setupStatus, setupRun, setupAuto, setupTerminal, setupStatusFull, setupIdentity } from './setup.mjs';
import { cloudDoctor } from './cloud.mjs';
import { overview } from './overview.mjs';
import { accountStatus, signup, login, logout, recover, resendConfirmation, oauthUrl, completeOAuth, syncProjects, setCloudConfig, cloudConfig, setLocale, exportAccount, deleteAccount } from './account.mjs';
import { aiKeysStatus, aiKeySet, aiKeyDelete } from './aikeys.mjs';
import { adminCommand, ADMIN_ACTIONS } from './admin.mjs';
import { billingCommand, billingCall } from './billing.mjs';
import { randomUUID } from 'node:crypto';
import { demoCreate } from './demo.mjs';
import { features as featureGates } from './features.mjs';
import { aiFix, aiApply, aiUsage, aiUndo } from './ai/index.mjs';
import { updateCheck, updateDownload } from './update.mjs';
import { logEvent, logTail, redactArgv, createReport, LOG_FILE } from './log.mjs';
import { hostingStatus, advise, setHosting, deployProject, hostingReady, providerStatus } from './hosting.mjs';
import { spaceshipConnect, spaceshipDisconnect, spaceshipDomains, spaceshipDns, connectDomainToNetlify } from './spaceship.mjs';
import { t, msg } from './i18n.mjs';
import { launchStatus } from './launch.mjs';
import { createSite, listTemplates } from './newsite.mjs';
import { generateSite, previewSite } from './sitegen/generate.mjs';
import { siteContent, siteChat, readContentArg } from './sitegen/aicontent.mjs';
import { editSite, undoSite, siteHistory, siteInfo } from './sitegen/edit.mjs';
import { loadTheme, validateTheme, previewStatus, suggestThemes } from './sitegen/themes.mjs';
import { STYLES, paletteIds } from './sitegen/tokens.mjs';

// engine/VERSION is the single source of the product version (build.sh writes it into Info.plist)
const VERSION = (() => {
  try {
    return readFileSync(join(ENGINE_DIR, 'VERSION'), 'utf8').trim();
  } catch {
    return '0.0.0';
  }
})();

const HELP = `Before I Deploy engine ${VERSION}

  bid project list | add --path P | remove --project K | touch --project K | rename --project K --name N
  bid status  --project P            dashboard snapshot (fast)
  bid detect  --project P
  bid audit   --project P            cloud HTTP audit (400 credits, reviewed price in billing estimate)
  bid check   --project P [--stop-on-fail] [--force] [--auto]   --force ignores the incremental cache; --auto (file watcher) refuses changed scripts
  bid smart   --project P [--prod --confirm DEPLOY] [--force]   check → draft (or production)
  bid local   start|stop|restart|status --project P [--mode auto|build|dev]
  bid git     status|fetch|push --project P
  bid git     commit --project P --message M [--files-json '["a","b"]']
  bid git     remote --project P --url URL
  bid netlify auth | login | teams | sites
  bid netlify info|link|create|deploy --project P [--id ID|--name N] [--team T] [--prod --confirm DEPLOY]
  bid fix     list --project P | apply ID --project P --yes
  bid history [--project P] [--limit N]
  bid aifix   --project P --step ID --target chatgpt|claude|codex|claude-code|copy
  bid ai      fix --project P --step ID [--deep] [--model M] [--provider anthropic|openai|cloud]   built-in AI Fix (streams 'ai' events)
  bid ai      explain --project P --step ID | apply --project P --patch-file F --yes [--files a,b] [--commit] [--allow-config] | usage
  bid demo create                  sample website in ~/Documents/Before I Deploy Demo, added to the list
  bid billing catalog | status | usage | sync | trial | portal | checkout --plan flash|high|knight [--yearly] | checkout --pack ID
  bid costs   [--refresh]          costs, credits, price table, budgets
  bid usage   [--refresh]          real limits from the providers
  bid budget  --netlify-min N
  bid setup   status | run ID --yes | auto --yes [--optional] | terminal ID|all
  bid overview [--no-network]      Mission Control
  bid spaceship status [--refresh] | connect (env BID_SPACESHIP_KEY/SECRET) | disconnect
  bid spaceship dns --domain D
  bid spaceship connect-domain --project P --domain D [--yes]   A @ + CNAME www → Netlify
  bid account status | signup --email E [--name N] | login --email E        password in env BID_PASSWORD (never a flag)
  bid account logout | recover --email E | resend --email E | oauth [--provider github] | session (env BID_ACCESS + BID_REFRESH) | sync
  bid account export | delete --confirm DELETE      GDPR: data export to ~/Downloads / delete the cloud account
  bid account locale --set L | keys status | keys set --provider anthropic|openai (env BID_AI_KEY) | keys delete --provider P
  bid admin   <action> [--user ID] [--json '{…}']   (admin only) actions: ${ADMIN_ACTIONS.join(', ')}
  bid features [--role R --plan P]                 feature gates for a role/plan
  bid update  check [--force] [--channel beta] | download        release feed from settings.release.url / BID_UPDATE_URL
  bid logs    [--tail N]                          engine.log entries (argv redacted)
  bid report                                      support report (zip) with redacted logs + doctor
  bid cloud config --url U --anon-key K | schema | doctor   doctor: schema applied? functions deployed? sign-up open?
  bid hosting status | advise --project P | set --project P --provider netlify|vercel|cloudflare|ghpages
  bid deploy  --project P [--prod --confirm DEPLOY] [--recheck-if-stale]   with the selected hosting
  bid issues  --project P          prioritized issues from the last check (severity, evidence, fix, verification)
  bid launch  --project P          launch checklist: folder → check → site quality → hosting → deploy → domain → monitoring
  bid new list | styles | check | create --template ID --name N --dir PARENT [--lang bg|en] [--description D] [--style calm|bold|elegant --palette P]
  bid new generate --brief brief.json --dir PARENT [--content c.json | --ai] | preview --brief brief.json [--content c.json]
  bid new content --brief brief.json [--provider cloud|anthropic]     the AI writes the texts (plan → content → review) into a content file
  bid site info | history | undo --project P                           a generated site: what it is, the edits, revert the last one
  bid site edit --project P --say "make it darker" [--force --dry-run --provider cloud|anthropic]   change the site with words (one commit each)
  bid monitor once [--project P] | status [--no-network] | incidents [--limit N] | settings --json '{…}' | agent install --yes | agent remove
  bid monitor cloud status | enable [--project P] [--interval N] [--paths /a,/b] | disable [--project P] | test --project P
  bid monitor maintenance add --from ISO --to ISO [--project P] [--note T] | list | clear · bid monitor notify test
  bid monitor pushover connect (env BID_PUSHOVER_USER + BID_PUSHOVER_TOKEN) | disconnect | status   push notifications to your phone
  bid backup  status --project P   backup provider state (CodeGuard: not connected until an API exists)
  bid project client --project K --name N       which client a site belongs to (portfolio filter)
  bid release preview --project P [--force]     check → preview deploy → smoke checks → awaits confirmation
  bid release promote --project P --op ID --confirm DEPLOY   publishes the smoke-tested preview, verifies production
  bid release status  --project P [--op ID] | rollback --confirm ROLLBACK [--deploy ID] | cancel --op ID
  bid fix apply ID --project P --yes [--recheck]   · bid ai apply … [--recheck] · bid ai undo --project P --yes
  bid ai chat --project P --action ask|diagnose|propose|review|explain|readiness|triage|fix [--message M] [--issue ID] [--files a,b] [--patch-file F] [--allow-create a,b] [--budget N] [--yes] [--new]
  bid ai history --project P [--limit N] · bid ai reset --project P · bid ai settings [--json '{…}'] · bid ai prompts
  bid doctor`;

function statusSnapshot(project) {
  const d = detect(project.path);
  const st = getState(project.key);
  const p = findProject(project.key) || project;
  return {
    project: { ...p, exists: d.exists !== false },
    detect: d,
    git: gitStatus(project.path),
    local: localStatus(project),
    check: st.check || null,
    lastDraft: st.lastDraft || null,
    lastProd: st.lastProd || null,
    netlifyAuth: netlifyAuth(),
    fixes: listFixes(project.path),
    issues: deriveIssues(st.check, { gitInstalled: !!gitAvailable(), hasGitignore: !!d.hasGitignore, hostingLoggedIn: providerStatus(p.hosting || 'netlify').loggedIn }),
    backup: backupStatus(p),
    release: { currentOp: st.release?.currentOp || null, lastOp: st.release?.lastOp || null, capabilities: capabilities(p.hosting || 'netlify'), aiUndo: st.aiUndo ? { at: st.aiUndo.at, step: st.aiUndo.step, files: st.aiUndo.applied } : null },
    hosting: (() => {
      const id = p.hosting || 'netlify';
      const st = providerStatus(id);
      return { provider: id, name: st.name, ready: hostingReady(p), preview: st.preview, installed: st.installed, loggedIn: st.loggedIn, liveUrl: p.liveUrl || p.netlify?.liveUrl || null };
    })(),
    launch: launchStatus({ project: p, detect: d, check: st.check || null, lastDraft: st.lastDraft || null, lastProd: st.lastProd || null, hostingReady: hostingReady(p), liveUrl: p.liveUrl || p.netlify?.liveUrl || null }),
  };
}

function doctor() {
  const v = (cmd, args = ['--version']) => {
    const path = cmd === 'git' ? gitAvailable() : which(cmd);
    if (!path) return null;
    const r = sh(cmd, args, { timeout: 15000 });
    return { path, version: (r.stdout || r.stderr).trim().split('\n')[0] };
  };
  return {
    engine: VERSION,
    engineDir: ENGINE_DIR,
    appDir: APP_DIR,
    cacheDir: CACHE_DIR,
    node: { path: process.execPath, version: process.version, runtime: process.env.BID_NODE_RUNTIME || 'system' },
    npm: v('npm'),
    pnpm: v('pnpm'),
    yarn: v('yarn'),
    bun: v('bun'),
    git: v('git'),
    netlify: v('netlify'),
    npx: which('npx'),
    netlifyAuth: netlifyAuth(),
    path: process.env.PATH,
    log: LOG_FILE(),
    // where keys go and what isolates project scripts on this machine (WP01)
    endpoints: endpoints(),
    production: isProductionBundle(),
    isolation: isolationLevel(),
    secrets: secretsBackend(),
  };
}

// Secrets never travel as command-line flags: argv is visible to every process (`ps`). The app and scripts
// pass them through the environment (audit E9).
function refuseSecretFlag(flags, flag, env) {
  if (flags[flag] !== undefined) throw new EngineError(msg('cli.secretInArgv', { flag: `--${flag}`, env }), 'secret_in_argv', 2);
}

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(process.argv.slice(3));
  ensureDir(APP_DIR);
  ensureDir(CACHE_DIR);
  const proj = () => resolveProject(flags.project);

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      process.stdout.write(HELP + '\n');
      return 0;

    case 'version':
      return ok({ version: VERSION });

    case 'doctor':
      return ok(doctor());

    case 'project': {
      switch (sub) {
        case 'list':
          return ok(listProjects());
        case 'add':
          return ok(upsertProject(flags.path || positional[1]));
        case 'remove':
          return ok({ removed: removeProject(flags.project) });
        case 'touch':
          return ok(upsertProject(proj().path));
        case 'rename': {
          const p = proj();
          return ok(updateProject(p.key, { customName: flags.name, name: flags.name }));
        }
        case 'client': {
          const p = proj();
          if (flags.name === undefined || flags.name === true) throw new EngineError(msg('project.client.missing'), 'usage', 2);
          const client = String(flags.name).trim().slice(0, 80) || null;
          return ok(updateProject(p.key, { client }));
        }
        default:
          throw new EngineError(msg('cli.unknownCommand', { command: `project ${sub}` }), 'usage', 2);
      }
    }

    case 'status':
      return ok(statusSnapshot(proj()));

    case 'launch':
      return ok(statusSnapshot(proj()).launch);

    case 'new': {
      if (sub === 'list' || !sub) return ok(listTemplates());
      if (sub === 'styles') return ok(Object.fromEntries(Object.keys(STYLES).map((id) => [id, { head: STYLES[id].head, radius: STYLES[id].radius, palettes: paletteIds(id).map((p) => ({ id: p, dark: !!STYLES[id].palettes[p].dark, bg: STYLES[id].palettes[p].bg, accent: STYLES[id].palettes[p].accent, accent2: STYLES[id].palettes[p].accent2 })) }])));
      if (sub === 'check') return ok(listTemplates().map((th) => ({ id: th.id, errors: validateTheme(loadTheme(th.id)), preview: previewStatus(th.id) })));
      // S5 "something else": the closest themes to the owner's words (no model)
      if (sub === 'suggest') return ok(suggestThemes(flags.say && flags.say !== true ? String(flags.say) : '', { limit: Number(flags.limit) || 3 }));
      if (sub === 'create') {
        if (flags.style || flags.palette) return ok(generateSite({ brief: { theme: flags.template, name: flags.name, lang: flags.lang, description: flags.description, style: flags.style, palette: flags.palette }, dir: flags.dir }));
        return ok(createSite({ template: flags.template, name: flags.name, dir: flags.dir, lang: flags.lang, description: flags.description }));
      }
      if (sub === 'generate' || sub === 'preview' || sub === 'content') {
        // the brief: a JSON file (the app writes one next to its form) or inline JSON
        const raw = flags.brief && flags.brief !== true ? String(flags.brief) : '';
        const brief = raw.trim().startsWith('{') ? JSON.parse(raw) : readJSON(raw, null);
        if (!brief) throw new EngineError(msg('newsite.missingBrief'), 'usage', 2);
        if (sub === 'content') return ok(await siteContent({ brief, provider: flags.provider && flags.provider !== true ? String(flags.provider) : null }));
        // ready content (the AI path, `bid new content`) replaces the theme's sample texts
        let content = readContentArg(flags.content);
        if (sub === 'generate' && flags.ai && !content) content = readContentArg((await siteContent({ brief, provider: flags.provider && flags.provider !== true ? String(flags.provider) : null })).contentFile);
        if (sub === 'preview') return ok(previewSite(brief, content));
        return ok(generateSite({ brief, dir: flags.dir, content }));
      }
      throw new EngineError(msg('cli.unknownCommand', { command: `new ${sub}` }), 'usage', 2);
    }

    case 'site': {
      if (sub === 'chat') {
        const raw = flags.messages && flags.messages !== true ? String(flags.messages) : '';
        const messages = raw.trim().startsWith('[') ? JSON.parse(raw) : readJSON(raw, null);
        if (!Array.isArray(messages)) throw new EngineError(msg('newsite.missingBrief'), 'usage', 2);
        return ok(await siteChat({ messages, model: flags.model && flags.model !== true ? String(flags.model) : 'auto', asked: flags.asked, provider: flags.provider && flags.provider !== true ? String(flags.provider) : null }));
      }
      const p = proj();
      if (sub === 'info' || !sub) return ok(siteInfo(p));
      if (sub === 'history') return ok(siteHistory(p));
      if (sub === 'undo') return ok(undoSite(p));
      if (sub === 'edit') return ok(await editSite(p, { say: flags.say, provider: flags.provider && flags.provider !== true ? String(flags.provider) : null, force: !!flags.force, dryRun: !!flags['dry-run'] }));
      throw new EngineError(msg('cli.unknownCommand', { command: `site ${sub}` }), 'usage', 2);
    }

    case 'detect':
      return ok(detect(proj().path));

    case 'check': {
      const p = proj();
      const check = await runChecks(p, { stopOnFail: !!flags['stop-on-fail'], force: !!flags.force, auto: !!flags.auto });
      if (check.status === 'blocked') ev.notify(`❌ ${p.name}`, t('check.notify.blocked'), null);
      if (flags.cloud) {
        await syncProjects();
        check.cloudReport = await billingCall('check_report', {projectKey:p.key,operationId:randomUUID(),status:check.status,counts:check.counts});
      }
      return ok(check);
    }

    case 'audit': {
      const p = proj();
      await syncProjects();
      return ok(await billingCommand('audit_run', {...flags,project:p.key}));
    }

    case 'smart': {
      const p = proj();
      const prod = !!flags.prod;
      if (prod && flags.confirm !== 'DEPLOY') throw new EngineError(msg('smart.confirmRequired'), 'confirm_required', 2);
      const check = await runChecks(p, { stopOnFail: true, force: !!flags.force });
      if (check.status === 'blocked') {
        ev.step('deploy', { label: t(prod ? 'deploy.label.production' : 'deploy.label.draft'), category: 'Hosting', status: 'skipped', summary: t('smart.step.stopped') });
        ev.notify(`❌ ${p.name}`, t('smart.notify.stopped'), null);
        throw new EngineError(msg('smart.blocked'), 'blocked', 3);
      }
      if (!hostingReady(p)) {
        ev.step('deploy', { label: t('smart.step.hosting'), category: 'Hosting', status: 'skipped', summary: t('smart.step.hostingNotLinked') });
        throw new EngineError(msg('smart.notLinked'), 'not_linked', 4);
      }
      const deploy = await deployProject(p, { prod, confirm: flags.confirm });
      return ok({ check, deploy });
    }

    case 'local': {
      const p = proj();
      const mode = flags.mode || 'auto';
      if (sub === 'start') return ok(await localStart(p, { mode }));
      if (sub === 'stop') return ok(await localStop(p));
      if (sub === 'restart') return ok(await localRestart(p, { mode: flags.mode }));
      if (sub === 'status') return ok(localStatus(p));
      throw new EngineError(msg('cli.unknownCommand', { command: `local ${sub}` }), 'usage', 2);
    }

    case 'git': {
      const p = proj();
      if (sub === 'status') return ok(gitStatus(p.path));
      if (sub === 'fetch') return ok(await gitFetch(p));
      if (sub === 'commit') {
        let files = null;
        if (flags['files-json']) {
          try {
            files = JSON.parse(flags['files-json']);
          } catch {
            throw new EngineError(msg('git.badFilesJson'), 'usage', 2);
          }
        }
        const r = await gitCommit(p, { message: flags.message, files });
        if (flags.push) return ok(await gitPush(p));
        return ok(r);
      }
      if (sub === 'push') return ok(await gitPush(p));
      if (sub === 'remote') {
        const r = gitSetRemote(p, flags.url);
        upsertProject(p.path);
        return ok(r);
      }
      throw new EngineError(msg('cli.unknownCommand', { command: `git ${sub}` }), 'usage', 2);
    }

    case 'netlify': {
      switch (sub) {
        case 'auth':
          return ok(netlifyAuth());
        case 'login':
          return ok(await netlifyLogin());
        case 'teams':
          return ok(await netlifyTeams());
        case 'sites':
          return ok(await netlifySites());
        case 'info':
          return ok(await netlifyInfo(proj()));
        case 'link':
          return ok(await netlifyLink(proj(), { id: flags.id, name: flags.name }));
        case 'create':
          return ok(await netlifyCreate(proj(), { name: flags.name, team: flags.team }));
        case 'deploy':
          return ok(await netlifyDeploy(proj(), { prod: !!flags.prod, confirm: flags.confirm }));
        default:
          throw new EngineError(msg('cli.unknownCommand', { command: `netlify ${sub}` }), 'usage', 2);
      }
    }

    case 'fix': {
      const p = proj();
      if (sub === 'list') return ok(listFixes(p.path));
      if (sub === 'apply') return ok(await applyFix(p, positional[1] || flags.id, { yes: !!flags.yes, recheck: !!flags.recheck }));
      throw new EngineError(msg('cli.unknownCommand', { command: `fix ${sub}` }), 'usage', 2);
    }

    case 'aifix':
      return ok(aifix(proj(), { step: flags.step, target: flags.target }));

    case 'ai': {
      if (sub === 'usage') return ok(await aiUsage());
      if (sub === 'prompts') return ok(listPrompts());
      if (sub === 'settings') return ok(flags.json && flags.json !== true ? setAssistantSettings(JSON.parse(flags.json)) : assistantSettings());
      const p = proj();
      if (sub === 'fix') return ok(await aiFix(p, { step: flags.step, model: flags.model, deep: !!flags.deep, provider: flags.provider }));
      if (sub === 'explain') return ok(await aiFix(p, { step: flags.step, model: flags.model, provider: flags.provider, mode: 'explain' }));
      if (sub === 'apply') return ok(await aiApply(p, { patchFile: flags['patch-file'], files: flags.files, yes: !!flags.yes, commit: !!flags.commit, recheck: !!flags.recheck, allowConfig: !!flags['allow-config'] }));
      if (sub === 'undo') return ok(await aiUndo(p, { yes: !!flags.yes, expectedUndoFile: flags['expected-undo-file'] }));
      if (sub === 'chat') return ok(await assistantChat(p, { action: flags.action, message: flags.message, issue: flags.issue, files: flags.files, patchFile: flags['patch-file'], allowCreate: flags['allow-create'], budget: flags.budget, yes: !!flags.yes, newConversation: !!flags.new, provider: flags.provider, model: flags.model }));
      if (sub === 'history') return ok(assistantHistory(p, { limit: flags.limit ? Number(flags.limit) : 50 }));
      if (sub === 'reset') return ok(assistantReset(p));
      if (sub === 'discard') return ok(discardConversationPatch(p, flags['patch-file']));
      throw new EngineError(msg('cli.unknownCommand', { command: `ai ${sub}` }), 'usage', 2);
    }

    case 'costs':
      return ok(await costSummary({ refresh: !!flags.refresh }));

    case 'usage':
      return ok(await providerUsage({ refresh: !!flags.refresh }));

    case 'prices':
      return ok(getPrices());

    case 'budget':
      return ok(setBudgets({ ...(flags['netlify-min'] !== undefined ? { netlifyMinCredits: Number(flags['netlify-min']) } : {}) }));

    case 'setup': {
      if (sub === 'identity') return ok(setupIdentity({ name: flags.name, email: flags.email, yes: !!flags.yes }));
      if (!sub || sub === 'status') return ok(flags.local ? await setupStatus() : await setupStatusFull());
      if (sub === 'run') return ok(await setupRun(positional[1] || flags.id, { yes: !!flags.yes }));
      if (sub === 'auto') {
        const data = await setupAuto({ yes: !!flags.yes, includeOptional: !!flags.optional });
        if (data.ok) return ok(data);
        emit({ type: 'result', ok: false, code: data.code, error: data.error, data });
        return 1;
      }
      if (sub === 'terminal') return ok(await setupTerminal(positional[1] || flags.id || 'all'));
      throw new EngineError(msg('cli.unknownCommand', { command: `setup ${sub}` }), 'usage', 2);
    }

    case 'spaceship': {
      if (!sub || sub === 'status') return ok(await spaceshipDomains({ refresh: !!flags.refresh }));
      if (sub === 'connect') {
        refuseSecretFlag(flags, 'key', 'BID_SPACESHIP_KEY');
        refuseSecretFlag(flags, 'secret', 'BID_SPACESHIP_SECRET');
        return ok(await spaceshipConnect({}));
      }
      if (sub === 'disconnect') return ok(spaceshipDisconnect());
      if (sub === 'dns') return ok(await spaceshipDns(flags.domain));
      if (sub === 'connect-domain') return ok(await connectDomainToNetlify(proj(), { domain: flags.domain, yes: !!flags.yes }));
      throw new EngineError(msg('cli.unknownCommand', { command: `spaceship ${sub}` }), 'usage', 2);
    }

    case 'account': {
      const email = flags.email;
      refuseSecretFlag(flags, 'password', 'BID_PASSWORD');
      const password = process.env.BID_PASSWORD;
      if (!sub || sub === 'status') return ok(await accountStatus());
      if (sub === 'signup') return ok(await signup({ email, password, name: flags.name }));
      if (sub === 'login') return ok(await login({ email, password }));
      if (sub === 'logout') return ok(await logout());
      if (sub === 'recover') return ok(await recover({ email }));
      if (sub === 'resend') return ok(await resendConfirmation({ email }));
      if (sub === 'oauth') return ok(oauthUrl({ provider: flags.provider || 'github' }));
      if (sub === 'session') {
        refuseSecretFlag(flags, 'access', 'BID_ACCESS');
        refuseSecretFlag(flags, 'refresh', 'BID_REFRESH');
        return ok(await completeOAuth({ access: process.env.BID_ACCESS, refresh: process.env.BID_REFRESH }));
      }
      if (sub === 'sync') return ok(await syncProjects());
      if (sub === 'locale') return ok(await setLocale(flags.set));
      if (sub === 'export') return ok(await exportAccount());
      if (sub === 'delete') return ok(await deleteAccount({ confirm: flags.confirm }));
      if (sub === 'keys') {
        const action = positional[1] || 'status';
        if (action === 'status') return ok(aiKeysStatus());
        if (action === 'set') return ok(await aiKeySet(flags.provider));
        if (action === 'delete') return ok(aiKeyDelete(flags.provider));
        throw new EngineError(msg('cli.unknownCommand', { command: `account keys ${action}` }), 'usage', 2);
      }
      throw new EngineError(msg('cli.unknownCommand', { command: `account ${sub}` }), 'usage', 2);
    }

    case 'cloud': {
      if (sub === 'config') return ok(setCloudConfig({ url: flags.url, anonKey: flags['anon-key'] }));
      if (sub === 'doctor') return ok(await cloudDoctor());
      if (sub === 'schema') {
        // installed engine: engine/supabase/schema.sql (copied by install.sh); dev checkout: ../supabase/schema.sql
        const file = [join(ENGINE_DIR, 'supabase', 'schema.sql'), join(ENGINE_DIR, '..', 'supabase', 'schema.sql')].find((f) => existsSync(f));
        return ok({ sql: file ? readFileSync(file, 'utf8') : null, file: file || null });
      }
      return ok({ configured: !!cloudConfig() });
    }

    case 'admin':
      return ok(await adminCommand(sub, flags));

    case 'billing':
      if (sub === 'usage' && flags.watch) {
        const interval = Math.max(10, Math.min(60, Number(flags.interval) || 10));
        for (;;) {
          emit({type:'usage',data:await billingCommand(sub, flags)});
          await new Promise(resolve => setTimeout(resolve, interval * 1000));
        }
      }
      return ok(await billingCommand(sub, flags));

    case 'demo':
      if (!sub || sub === 'create') return ok(demoCreate());
      throw new EngineError(msg('cli.unknownCommand', { command: `demo ${sub}` }), 'usage', 2);

    case 'features':
      return ok(featureGates({ role: flags.role, plan: flags.plan, aiDisabled: !!flags['ai-disabled'], hasOwnKey: !!flags['own-key'] }));

    case 'update': {
      const channel = flags.channel && flags.channel !== true ? flags.channel : 'stable';
      // the app passes its own version: that is what an update replaces (audit B5)
      const current = flags.current && flags.current !== true ? String(flags.current) : VERSION;
      if (!sub || sub === 'check') return ok(await updateCheck({ current, force: !!flags.force, channel, format: flags.format === 'deb' ? 'deb' : undefined }));
      if (sub === 'download') return ok(await updateDownload({ current, channel, format: flags.format === 'deb' ? 'deb' : undefined }));
      throw new EngineError(msg('cli.unknownCommand', { command: `update ${sub}` }), 'usage', 2);
    }

    case 'logs':
      return ok({ file: LOG_FILE(), entries: logTail(Number(flags.tail) || 200) });

    case 'report':
      return ok(createReport({ doctor: doctor(), version: VERSION }));

    case 'hosting': {
      if (!sub || sub === 'status') return ok(hostingStatus());
      if (sub === 'advise') return ok(advise(proj()));
      if (sub === 'set') return ok(setHosting(proj(), flags.provider));
      throw new EngineError(msg('cli.unknownCommand', { command: `hosting ${sub}` }), 'usage', 2);
    }

    case 'deploy': {
      const p = proj();
      try {
        return ok(await deployProject(p, { prod: !!flags.prod, confirm: flags.confirm }));
      } catch (e) {
        // --recheck-if-stale: the app asks for a draft; when the check is old or the code changed, run a fresh
        // check first instead of failing (the production guard is untouched: still confirm + fresh check)
        if (!flags['recheck-if-stale'] || flags.prod || !['stale_check', 'needs_check'].includes(e.code)) throw e;
        const check = await runChecks(p, { stopOnFail: true });
        if (check.status === 'blocked') throw new EngineError(msg('smart.blocked'), 'blocked', 3);
        return ok(await deployProject(p, { prod: false }));
      }
    }

    case 'overview':
      return ok(await overview({ network: !flags['no-network'] }));

    case 'monitor': {
      if (sub === 'once') return ok(await monitorOnce({ project: flags.project && flags.project !== true ? proj().key : null }));
      if (!sub || sub === 'status') return ok(flags['no-network'] ? monitorStatus() : await monitorStatusMerged());
      if (sub === 'cloud') {
        const action = positional[1];
        const key = flags.project && flags.project !== true ? proj().key : null;
        if (action === 'enable') return ok(await monitorCloudEnable({ project: key, intervalMin: flags.interval ? Number(flags.interval) : null, paths: flags.paths && flags.paths !== true ? String(flags.paths).split(',').map((x) => x.trim()).filter(Boolean) : null }));
        if (action === 'disable') return ok(await monitorCloudDisable({ project: key }));
        if (action === 'test') return ok(await monitorCloudTest({ project: key }));
        return ok(await monitorCloudStatus());
      }
      if (sub === 'maintenance') return ok(await maintenanceCommand(positional[1], flags));
      if (sub === 'notify') return ok(await notifyTest());
      if (sub === 'pushover') {
        if (positional[1] === 'connect') {
          refuseSecretFlag(flags, 'token', 'BID_PUSHOVER_TOKEN');
          return ok(await pushoverConnect({ user: flags.user }));
        }
        if (positional[1] === 'disconnect') return ok(pushoverDisconnect());
        return ok(pushoverStatus());
      }
      if (sub === 'incidents') return ok(listIncidents({ limit: Number(flags.limit) || 100, project: flags.project && flags.project !== true ? proj().key : null }));
      if (sub === 'settings') return ok(await setMonitorSettings(flags.json && flags.json !== true ? JSON.parse(flags.json) : {}));
      if (sub === 'agent') {
        if (positional[1] === 'install') return ok(agentInstall({ yes: !!flags.yes }));
        if (positional[1] === 'remove') return ok(agentRemove());
        return ok(monitorStatus().agent);
      }
      throw new EngineError(msg('cli.unknownCommand', { command: `monitor ${sub}` }), 'usage', 2);
    }

    case 'backup': {
      if (!sub || sub === 'status') return ok(backupStatus(proj()));
      throw new EngineError(msg('cli.unknownCommand', { command: `backup ${sub}` }), 'usage', 2);
    }

    case 'issues': {
      const p = proj();
      const st = getState(p.key);
      return ok({ project: p.key, ...deriveIssues(st.check, { gitInstalled: !!gitAvailable(), hasGitignore: !!detect(p.path).hasGitignore, hostingLoggedIn: providerStatus(p.hosting || 'netlify').loggedIn }) });
    }

    case 'release': {
      const p = proj();
      if (sub === 'preview') return ok(await releasePreview(p, { force: !!flags.force }));
      if (sub === 'promote') return ok(await releasePromote(p, { op: flags.op, confirm: flags.confirm }));
      if (!sub || sub === 'status') return ok(await releaseStatus(p, { op: flags.op && flags.op !== true ? flags.op : null }));
      if (sub === 'rollback') return ok(await releaseRollback(p, { confirm: flags.confirm, deploy: flags.deploy }));
      if (sub === 'cancel') return ok(releaseCancel(p, { op: flags.op }));
      throw new EngineError(msg('cli.unknownCommand', { command: `release ${sub}` }), 'usage', 2);
    }

    case 'history': {
      let key = null;
      if (flags.project) key = (findProject(flags.project) || {}).key || flags.project;
      return ok(listHistory({ key, limit: Number(flags.limit) || 50 }));
    }

    default:
      throw new EngineError(msg('cli.unknownCommandHelp', { command: cmd, help: HELP }), 'usage', 2);
  }
}

// every command leaves one line in engine.log (WP6.9); crashes are reported as a result line, never a stack trace
const startedAt = Date.now();
const argvForLog = redactArgv(process.argv.slice(2));
const logOutcome = (extra) => logEvent({ cmd: argvForLog[0] || 'help', argv: argvForLog, ms: Date.now() - startedAt, ...extra });
const crash = (e) => {
  logOutcome({ ok: false, code: e?.code || 'crash', error: String(e?.message || e), stack: e?.stack ? String(e.stack).split('\n').slice(0, 5) : undefined });
  exitAfterFlush(fail(e));
};
process.on('unhandledRejection', crash);
process.on('uncaughtException', crash);

main()
  .then((code) => {
    logOutcome({ ok: typeof code !== 'number' || code === 0, exit: typeof code === 'number' ? code : 0 });
    exitAfterFlush(code);
  })
  .catch((e) => {
    logOutcome({ ok: false, code: e?.code || 'error', error: String(e?.message || e) });
    exitAfterFlush(fail(e));
  });
