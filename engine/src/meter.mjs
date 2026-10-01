// Durable accounting around the provider boundary. No provider key or source code enters this journal.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, readJSON, ev, EngineError } from './util.mjs';
import { cloudConfig, currentSession, rest } from './account.mjs';
import { billingCall } from './billing.mjs';
import { msg, t } from './i18n.mjs';

const inFlight = new Set();
const directory = () => path.join(APP_DIR, 'meter-operations');
function save(record) {
  fs.mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const file = path.join(directory(), `${record.operationId}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** Retries only accounting, never the provider operation. Other accounts/hosts are never touched. */
export async function reconcileMeter(session) {
  if (!session?.user?.id || !cloudConfig()) return;
  const files = fs.existsSync(directory()) ? fs.readdirSync(directory()).filter(f => /^[\w-]+\.json$/.test(f)) : [];
  for (const file of files.slice(-200)) {
    const row = readJSON(path.join(directory(), file), null);
    if (!row || row.operationId + '.json' !== file || !Number.isSafeInteger(row.pid) || row.pid <= 0 || inFlight.has(row.operationId)) continue;
    if (row?.userId !== session.user.id || row.cloudUrl !== cloudConfig().url || ['settled','released'].includes(row.state)) continue;
    // Another engine process may still be running this operation. TTL cleanup belongs to the server.
    if (row.pid !== process.pid) { try { process.kill(row.pid, 0); continue; } catch {} }
    const kind = row.state === 'dispatched' ? 'settle' : 'release';
    try {
      await billingCall('meter', {kind, operationId:row.operationId}, {session});
      save({...row,state:kind === 'settle' ? 'settled' : 'released'});
    } catch (error) {
      // A missing reservation means the initial reserve never committed.
      if (row.state !== 'dispatched' && error.status === 404) save({...row,state:'released'});
      else throw error;
    }
  }
}

/** Call only after local validation/staging, immediately before invoking the provider.
 * A provider CLI invocation is the dispatch boundary; a failure to launch releases the reservation.
 * Offline/local-only workflows and privileged own-provider accounts have no BID cloud charge.
 */
export async function meteredProviderCall(project, usageAction, invoke) {
  if (process.env.BID_BILLING_DEMO === '1') throw new EngineError(msg('billing.demoReadOnly'), 'demo_read_only', 2);
  const config = cloudConfig();
  const session = config ? await currentSession() : null;
  if (!session) return invoke();
  const rows = await rest(`/profiles?select=role&user_id=eq.${encodeURIComponent(session.user?.id)}`, {token:session.accessToken});
  if (['admin','vip'].includes(rows?.[0]?.role)) return invoke();
  if (!rows?.[0]) throw new EngineError(msg('billing.meterUnavailable'), 'meter_unavailable');
  await reconcileMeter(session);
  const operationId = crypto.randomUUID();
  let row = {operationId, userId:session.user.id, cloudUrl:config.url, projectKey:project.key, usageAction, state:'reserving', pid:process.pid, at:new Date().toISOString()};
  save(row);
  inFlight.add(operationId);
  try {
  await billingCall('meter', {kind:'reserve',operationId,projectKey:project.key,usageAction}, {session});
  row = {...row,state:'dispatched'}; save(row);
  let result, failure;
  try { result = await invoke(); } catch (error) { failure = error; }
  const notLaunched = ['ENOENT','EACCES','no_cli'].includes(failure?.code) || result?.code === 127;
  const kind = notLaunched ? 'release' : 'settle';
  if (notLaunched) { row = {...row,state:'release_pending'}; save(row); }
  try {
    await billingCall('meter', {kind,operationId}, {session});
    save({...row,state:kind === 'settle' ? 'settled' : 'released'});
  } catch {
    // Keep the receipt for recovery. Never imply publishing failed solely because receipt delivery failed.
    ev.info(t('billing.receiptPending'));
  }
  if (failure) throw failure;
  return result;
  } finally { inFlight.delete(operationId); }
}
