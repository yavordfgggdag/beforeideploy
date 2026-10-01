// Backups — CodeGuard boundary (V11).
//
// There is no CodeGuard API documentation, SDK, partner agreement or credential in this repository, so
// nothing here talks to CodeGuard. This module is the seam a real integration plugs into: it reports an
// honest "not connected" state with exactly what is missing, and the shape every backup provider must
// return. The app never shows a simulated backup as protection.
//
// Contract for a real adapter (same file, once the API is known):
//   status(project)  → { provider, connected: true, siteId, lastBackupAt, nextBackupAt, retentionDays, healthy, source, at }
//   list(project)    → [{ id, at, sizeBytes, kind: 'full' | 'incremental', restorable: boolean }]
//   request(project) → { requested: true, jobId }
//   restore(project, backupId, { confirm: 'RESTORE', target: 'production' | 'staging' }) → { jobId, affects: [...] }
import { getSecret } from '../../secrets.mjs';
import { readJSON, APP_DIR } from '../../util.mjs';
import path from 'node:path';

export const meta = { id: 'codeguard', name: 'CodeGuard', kind: 'backup' };

/** Settings the owner sets once the partnership exists (cloud `settings` table or profile cache). */
function config() {
  const profile = readJSON(path.join(APP_DIR, 'profile.json'), null);
  const settings = profile?.settings || {};
  return {
    apiBase: typeof settings['backup.codeguard.apiBase'] === 'string' ? settings['backup.codeguard.apiBase'] : null,
    token: getSecret('codeguard') || null,
  };
}

export function backupStatus(project) {
  const c = config();
  const missing = [];
  if (!c.apiBase) missing.push('settings: backup.codeguard.apiBase (Admin → Global settings)');
  if (!c.token) missing.push('Keychain: account "codeguard" (bid backup connect, once the API token exists)');
  missing.push('CodeGuard API documentation and a partner agreement — not in this repository');
  return {
    provider: meta.id,
    name: meta.name,
    connected: false,
    state: 'unsupported',
    reason: 'not_configured',
    missing,
    project: project?.key || null,
    lastBackupAt: null,
    capabilities: { status: false, list: false, request: false, restore: false },
    source: null,
    at: new Date().toISOString(),
  };
}
