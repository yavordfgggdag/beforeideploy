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

// Keychain values are stored as `b64:<base64 JSON>`: the `security -i` line parser does not handle escaped
// quotes, and base64 has no quotes or spaces. Older plain-JSON values are still read.
const B64 = 'b64:';
const encode = (data) => B64 + Buffer.from(data, 'utf8').toString('base64');
const decode = (stored) => (stored.startsWith(B64) ? Buffer.from(stored.slice(B64.length), 'base64').toString('utf8') : stored);

export function setSecret(account, value) {
  const data = JSON.stringify(value);
  if (which('security') && !process.env.BID_NO_KEYCHAIN) {
    // the secret goes through stdin (`security -i`), never argv — argv is visible to every process via `ps`
    const stored = encode(data);
    const line = ['add-generic-password', '-U', '-s', securityQuote(SERVICE), '-a', securityQuote(account), '-w', securityQuote(stored)].join(' ');
    const r = sh('security', ['-i'], { input: `${line}\n` });
    if (r.code !== 0 || /error|usage/i.test(r.stderr)) throw new Error(`Keychain: ${(r.stderr || r.stdout).trim()}`);
    // read back: the interactive parser must have stored exactly this value
    const check = sh('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
    if (check.code !== 0 || check.stdout.trim() !== stored) throw new Error('Keychain: the saved value could not be read back');
    return;
  }
  const f = fallbackFile(account);
  fs.writeFileSync(f, data, { mode: 0o600 });
}

export function getSecret(account) {
  if (which('security') && !process.env.BID_NO_KEYCHAIN) {
    // a locked or prompting keychain must never freeze the engine (headless Macs, CI): 8 s, then "no secret"
    const r = sh('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w'], { timeout: 8000 });
    if (r.code !== 0) return null;
    try {
      return JSON.parse(decode(r.stdout.trim()));
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
