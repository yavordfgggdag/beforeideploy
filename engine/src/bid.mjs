#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// Before I Deploy V6 — engine entrypoint. Every command prints NDJSON; the last line is {"type":"result",...}.
import { parseArgs, ok, fail, ev, sh, which, EngineError, APP_DIR, CACHE_DIR, ENGINE_DIR, ensureDir } from './util.mjs';
import { detect } from './detect.mjs';
import { listProjects, upsertProject, removeProject, resolveProject, updateProject, getState, listHistory, findProject } from './store.mjs';
import { runChecks } from './checks.mjs';
import { localStart, localStop, localRestart, localStatus } from './local.mjs';
import { gitStatus, gitFetch, gitCommit, gitPush, gitSetRemote } from './git.mjs';
import { netlifyAuth, netlifyLogin, netlifyTeams, netlifySites, netlifyInfo, netlifyLink, netlifyCreate, netlifyDeploy } from './netlify.mjs';
import { listFixes, applyFix } from './fixes.mjs';
import { aifix } from './aifix.mjs';
import { costSummary, providerUsage, setBudgets, getPrices } from './costs.mjs';
import { setupStatus, setupRun, setupAuto, setupTerminal } from './setup.mjs';
import { overview } from './overview.mjs';
import { accountStatus, signup, login, logout, recover, oauthUrl, completeOAuth, syncProjects, setCloudConfig, cloudConfig, setLocale, exportAccount, deleteAccount } from './account.mjs';
import { aiKeysStatus, aiKeySet, aiKeyDelete } from './aikeys.mjs';
import { adminCommand, ADMIN_ACTIONS } from './admin.mjs';
import { features as featureGates } from './features.mjs';
import { aiFix, aiApply, aiUsage } from './ai/index.mjs';
import { updateCheck, updateDownload } from './update.mjs';
import { logEvent, logTail, redactArgv, createReport, LOG_FILE } from './log.mjs';
import { hostingStatus, advise, setHosting, deployProject, hostingReady, providerStatus } from './hosting.mjs';
import { spaceshipConnect, spaceshipDisconnect, spaceshipDomains, spaceshipDns, connectDomainToNetlify } from './spaceship.mjs';
import { t, msg } from './i18n.mjs';

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
  bid check   --project P [--stop-on-fail] [--force]     --force ignores the incremental cache
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
  bid ai      explain --project P --step ID | apply --project P --patch-file F --yes [--files a,b] [--commit] | usage
  bid costs   [--refresh]          costs, credits, price table, budgets
  bid usage   [--refresh]          real limits from the providers
  bid budget  --netlify-min N
  bid setup   status | run ID --yes | auto --yes [--optional] | terminal ID|all
  bid overview [--no-network]      Mission Control
  bid spaceship status [--refresh] | connect (env BID_SPACESHIP_KEY/SECRET) | disconnect
  bid spaceship dns --domain D
  bid spaceship connect-domain --project P --domain D [--yes]   A @ + CNAME www → Netlify
  bid account status | signup --email E --password P [--name N] | login --email E --password P
  bid account logout | recover --email E | oauth [--provider github] | session --access A --refresh R | sync
  bid account export | delete --confirm DELETE      GDPR: data export to ~/Downloads / delete the cloud account
  bid account locale --set L | keys status | keys set --provider anthropic|openai (env BID_AI_KEY) | keys delete --provider P
  bid admin   <action> [--user ID] [--json '{…}']   (admin only) actions: ${ADMIN_ACTIONS.join(', ')}
  bid features [--role R --plan P]                 feature gates for a role/plan
  bid update  check [--force] [--channel beta] | download        release feed from settings.release.url / BID_UPDATE_URL
  bid logs    [--tail N]                          engine.log entries (argv redacted)
  bid report                                      support report (zip) with redacted logs + doctor
  bid cloud config --url U --anon-key K | schema
  bid hosting status | advise --project P | set --project P --provider netlify|vercel|cloudflare|ghpages
  bid deploy  --project P [--prod --confirm DEPLOY]        with the selected hosting
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
    hosting: (() => {
      const id = p.hosting || 'netlify';
      const st = providerStatus(id);
      return { provider: id, name: st.name, ready: hostingReady(p), preview: st.preview, installed: st.installed, loggedIn: st.loggedIn, liveUrl: p.liveUrl || p.netlify?.liveUrl || null };
    })(),
  };
}

function doctor() {
  const v = (cmd, args = ['--version']) => {
    const path = which(cmd);
    if (!path) return null;
    const r = sh(cmd, args, { timeout: 15000 });
    return { path, version: (r.stdout || r.stderr).trim().split('\n')[0] };
  };
  return {
    engine: VERSION,
    engineDir: ENGINE_DIR,
    appDir: APP_DIR,
    cacheDir: CACHE_DIR,
    node: { path: process.execPath, version: process.version },
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
  };
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
        default:
          throw new EngineError(msg('cli.unknownCommand', { command: `project ${sub}` }), 'usage', 2);
      }
    }

    case 'status':
      return ok(statusSnapshot(proj()));

    case 'detect':
      return ok(detect(proj().path));

    case 'check': {
      const p = proj();
      const check = await runChecks(p, { stopOnFail: !!flags['stop-on-fail'], force: !!flags.force });
      if (check.status === 'blocked') ev.notify(`❌ ${p.name}`, t('check.notify.blocked'), null);
      return ok(check);
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
      if (sub === 'apply') return ok(await applyFix(p, positional[1] || flags.id, { yes: !!flags.yes }));
      throw new EngineError(msg('cli.unknownCommand', { command: `fix ${sub}` }), 'usage', 2);
    }

    case 'aifix':
      return ok(aifix(proj(), { step: flags.step, target: flags.target }));

    case 'ai': {
      if (sub === 'usage') return ok(await aiUsage());
      const p = proj();
      if (sub === 'fix') return ok(await aiFix(p, { step: flags.step, model: flags.model, deep: !!flags.deep, provider: flags.provider }));
      if (sub === 'explain') return ok(await aiFix(p, { step: flags.step, model: flags.model, provider: flags.provider, mode: 'explain' }));
      if (sub === 'apply') return ok(await aiApply(p, { patchFile: flags['patch-file'], files: flags.files, yes: !!flags.yes, commit: !!flags.commit }));
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
      if (!sub || sub === 'status') return ok(setupStatus());
      if (sub === 'run') return ok(await setupRun(positional[1] || flags.id, { yes: !!flags.yes }));
      if (sub === 'auto') return ok(await setupAuto({ yes: !!flags.yes, includeOptional: !!flags.optional }));
      if (sub === 'terminal') return ok(setupTerminal(positional[1] || flags.id || 'all'));
      throw new EngineError(msg('cli.unknownCommand', { command: `setup ${sub}` }), 'usage', 2);
    }

    case 'spaceship': {
      if (!sub || sub === 'status') return ok(await spaceshipDomains({ refresh: !!flags.refresh }));
      if (sub === 'connect') return ok(await spaceshipConnect({ key: flags.key, secret: flags.secret }));
      if (sub === 'disconnect') return ok(spaceshipDisconnect());
      if (sub === 'dns') return ok(await spaceshipDns(flags.domain));
      if (sub === 'connect-domain') return ok(await connectDomainToNetlify(proj(), { domain: flags.domain, yes: !!flags.yes }));
      throw new EngineError(msg('cli.unknownCommand', { command: `spaceship ${sub}` }), 'usage', 2);
    }

    case 'account': {
      const email = flags.email;
      const password = flags.password || process.env.BID_PASSWORD;
      if (!sub || sub === 'status') return ok(await accountStatus());
      if (sub === 'signup') return ok(await signup({ email, password, name: flags.name }));
      if (sub === 'login') return ok(await login({ email, password }));
      if (sub === 'logout') return ok(await logout());
      if (sub === 'recover') return ok(await recover({ email }));
      if (sub === 'oauth') return ok(oauthUrl({ provider: flags.provider || 'github' }));
      if (sub === 'session') return ok(await completeOAuth({ access: flags.access || process.env.BID_ACCESS, refresh: flags.refresh || process.env.BID_REFRESH }));
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
      if (sub === 'schema') {
        // installed engine: engine/supabase/schema.sql (copied by install.sh); dev checkout: ../supabase/schema.sql
        const file = [join(ENGINE_DIR, 'supabase', 'schema.sql'), join(ENGINE_DIR, '..', 'supabase', 'schema.sql')].find((f) => existsSync(f));
        return ok({ sql: file ? readFileSync(file, 'utf8') : null, file: file || null });
      }
      return ok({ configured: !!cloudConfig() });
    }

    case 'admin':
      return ok(await adminCommand(sub, flags));

    case 'features':
      return ok(featureGates({ role: flags.role, plan: flags.plan, aiDisabled: !!flags['ai-disabled'], hasOwnKey: !!flags['own-key'] }));

    case 'update': {
      const channel = flags.channel && flags.channel !== true ? flags.channel : 'stable';
      if (!sub || sub === 'check') return ok(await updateCheck({ current: VERSION, force: !!flags.force, channel }));
      if (sub === 'download') return ok(await updateDownload({ current: VERSION, channel }));
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

    case 'deploy':
      return ok(await deployProject(proj(), { prod: !!flags.prod, confirm: flags.confirm }));

    case 'overview':
      return ok(await overview({ network: !flags['no-network'] }));

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
  process.exit(fail(e));
};
process.on('unhandledRejection', crash);
process.on('uncaughtException', crash);

main()
  .then((code) => {
    logOutcome({ ok: true, exit: typeof code === 'number' ? code : 0 });
    process.exit(typeof code === 'number' ? code : 0);
  })
  .catch((e) => {
    logOutcome({ ok: false, code: e?.code || 'error', error: String(e?.message || e) });
    process.exit(fail(e));
  });
