// Secrets in the macOS Keychain (falls back to a 0600 file only where `security` does not exist, e.g. tests on Linux)
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, sh, which, ensureDir } from './util.mjs';

const SERVICE = 'BeforeIDeploy';

function fallbackFile(account) {
  return path.join(ensureDir(path.join(APP_DIR, 'secrets')), `${account}.json`);
}

/** Quotes one argument for `security -i` (its parser understands double quotes and backslash escapes). */
export function securityQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function setSecret(account, value) {
  const data = JSON.stringify(value);
  if (which('security') && !process.env.BID_NO_KEYCHAIN) {
    // the secret goes through stdin (`security -i`), never argv — argv is visible to every process via `ps`
    const line = ['add-generic-password', '-U', '-s', securityQuote(SERVICE), '-a', securityQuote(account), '-w', securityQuote(data)].join(' ');
    const r = sh('security', ['-i'], { input: `${line}\n` });
    if (r.code !== 0 || /error|usage/i.test(r.stderr)) throw new Error(`Keychain: ${(r.stderr || r.stdout).trim()}`);
    // read back: the interactive parser must have stored exactly this value
    const check = sh('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    if (check.code !== 0 || check.stdout.trim() !== data) throw new Error('Keychain: the saved value could not be read back');
    return;
  }
  const f = fallbackFile(account);
  fs.writeFileSync(f, data, { mode: 0o600 });
}

export function getSecret(account) {
  if (which('security') && !process.env.BID_NO_KEYCHAIN) {
    const r = sh('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    if (r.code !== 0) return null;
    try {
      return JSON.parse(r.stdout.trim());
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(fs.readFileSync(fallbackFile(account), 'utf8'));
  } catch {
    return null;
  }
}

export function deleteSecret(account) {
  if (which('security') && !process.env.BID_NO_KEYCHAIN) {
    sh('security', ['delete-generic-password', '-s', SERVICE, '-a', account]);
    return;
  }
  try {
    fs.unlinkSync(fallbackFile(account));
  } catch {}
}
