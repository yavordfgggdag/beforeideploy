// Secrets (sessions, AI keys, Pushover, Spaceship) in the operating system's protected store:
//   macOS   — the Keychain (`security`), as always. BID_NO_KEYCHAIN=1 or no `security`: a 0600 file (tests).
//   Linux   — the Secret Service (GNOME Keyring, KWallet …) through libsecret's `secret-tool`; without one, an
//             encrypted file (AES-256-GCM, key from BID_SECRETS_PASSPHRASE via scrypt). No passphrase →
//             `secrets_unavailable`, never plaintext.
//   Windows — DPAPI (CurrentUser scope) through PowerShell; the protected blob lives in a file.
// BID_NO_KEYCHAIN=1 skips the OS store (tests): macOS uses the plain file as before, Linux/Windows the
// encrypted file. Plain files left by earlier Linux builds are moved into the protected store when read.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR, EngineError, sh, which, ensureDir } from './util.mjs';
import { msg } from './i18n.mjs';
import { platformOf, linux, win32 } from './platform/index.mjs';

const SERVICE = 'BeforeIDeploy';

function secretsDir() {
  const dir = ensureDir(path.join(APP_DIR, 'secrets'));
  if (platformOf() !== 'darwin') try { fs.chmodSync(dir, 0o700); } catch {} // POSIX modes; Windows: the profile ACL
  return dir;
}

function fallbackFile(account) {
  return path.join(secretsDir(), `${account}.json`);
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

const noStore = () => !!process.env.BID_NO_KEYCHAIN;
const unavailable = () => new EngineError(msg('secrets.unavailable'), 'secrets_unavailable');

/** Where secrets go on this machine (doctor shows it): keychain | file | secret-service | encrypted-file | dpapi | unavailable. */
export function secretsBackend() {
  const os = platformOf();
  if (os === 'darwin') return which('security') && !noStore() ? 'keychain' : 'file';
  if (os === 'win32' && !noStore()) return 'dpapi';
  if (os === 'linux' && !noStore() && which('secret-tool')) return 'secret-service';
  return process.env.BID_SECRETS_PASSPHRASE ? 'encrypted-file' : 'unavailable';
}

// ---------------------------------------------------------------- encrypted file (Linux/Windows fallback)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keys = new Map(); // salt → derived key, once per process

function deriveKey(passphrase, salt) {
  const id = `${salt.toString('hex')}:${crypto.createHash('sha256').update(passphrase).digest('hex')}`;
  if (!keys.has(id)) keys.set(id, crypto.scryptSync(passphrase, salt, 32, SCRYPT));
  return keys.get(id);
}

const encFile = (account) => path.join(secretsDir(), `${account}.enc`);

/** AES-256-GCM with a per-file salt and IV; the account name is authenticated data (no swapping files). */
export function sealSecret(account, data, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAAD(Buffer.from(`${SERVICE}:${account}`));
  const body = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const b = (x) => x.toString('base64');
  return JSON.stringify({ v: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: b(salt), iv: b(iv), tag: b(cipher.getAuthTag()), data: b(body) });
}

/** The plaintext, or null when the passphrase is wrong or the file was changed. */
export function openSecret(account, sealed, passphrase) {
  try {
    const f = JSON.parse(sealed);
    if (f.v !== 1 || f.kdf !== 'scrypt' || f.N !== SCRYPT.N) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, Buffer.from(f.salt, 'base64')), Buffer.from(f.iv, 'base64'));
    d.setAAD(Buffer.from(`${SERVICE}:${account}`));
    d.setAuthTag(Buffer.from(f.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function writePrivate(file, text) {
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function setEncrypted(account, data) {
  const pass = process.env.BID_SECRETS_PASSPHRASE;
  if (!pass) throw unavailable();
  writePrivate(encFile(account), sealSecret(account, data, pass));
}

function getEncrypted(account) {
  const pass = process.env.BID_SECRETS_PASSPHRASE;
  if (!pass) return null;
  try {
    return openSecret(account, fs.readFileSync(encFile(account), 'utf8'), pass);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Linux: Secret Service (secret-tool)

function setSecretService(account, data) {
  const attrs = linux.secretAttrs(SERVICE, account);
  // the secret goes through stdin, never argv
  const r = sh('secret-tool', ['store', '--label', `Before I Deploy (${account})`, ...attrs], { input: encode(data), timeout: 8000 });
  if (r.code !== 0) return false;
  const check = sh('secret-tool', ['lookup', ...attrs], { timeout: 8000 });
  return check.code === 0 && check.stdout.trim() === encode(data);
}

function getSecretService(account) {
  // a locked keyring that prompts must never freeze the engine: 8 s, then "no secret"
  const r = sh('secret-tool', ['lookup', ...linux.secretAttrs(SERVICE, account)], { timeout: 8000 });
  return r.code === 0 && r.stdout.trim() ? decode(r.stdout.trim()) : null;
}

// ---------------------------------------------------------------- Windows: DPAPI

const dpapiFile = (account) => path.join(secretsDir(), `${account}.dpapi`);

function dpapi(op, base64) {
  const r = sh(win32.powershellExe(process.env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', win32.encodePowerShell(win32.dpapiScript(op))], { input: base64, timeout: 20000 });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

function setDpapi(account, data) {
  const blob = dpapi('protect', Buffer.from(data, 'utf8').toString('base64'));
  if (!blob) throw unavailable();
  writePrivate(dpapiFile(account), blob);
}

function getDpapi(account) {
  let blob;
  try { blob = fs.readFileSync(dpapiFile(account), 'utf8').trim(); } catch { return null; }
  const out = dpapi('unprotect', blob);
  return out ? Buffer.from(out, 'base64').toString('utf8') : null;
}

// ---------------------------------------------------------------- API

/** Stores into the protected store of this OS (Linux/Windows: never plaintext). */
function setProtected(account, data) {
  const backend = secretsBackend();
  if (backend === 'dpapi') return setDpapi(account, data);
  if (backend === 'secret-service' && setSecretService(account, data)) {
    fs.rmSync(encFile(account), { force: true });
    return;
  }
  // no Secret Service daemon (a server, a minimal desktop): the encrypted file, or a clear refusal
  setEncrypted(account, data);
}

function getProtected(account) {
  const backend = secretsBackend();
  if (backend === 'dpapi') return getDpapi(account);
  if (backend === 'secret-service') {
    const v = getSecretService(account);
    if (v !== null) return v;
  }
  return getEncrypted(account);
}

export function setSecret(account, value) {
  const data = JSON.stringify(value);
  if (platformOf() !== 'darwin') {
    setProtected(account, data);
    fs.rmSync(fallbackFile(account), { force: true }); // a plain file from an earlier build must not linger
    return;
  }
  if (which('security') && !noStore()) {
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
  if (platformOf() !== 'darwin') {
    const v = getProtected(account);
    if (v !== null) {
      try { return JSON.parse(v); } catch { return null; }
    }
    // a plain file an earlier Linux build wrote: move it into the protected store, then remove it
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(fallbackFile(account), 'utf8')); } catch { return null; }
    try {
      setProtected(account, JSON.stringify(legacy));
      fs.rmSync(fallbackFile(account), { force: true });
    } catch {}
    return legacy;
  }
  if (which('security') && !noStore()) {
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
  if (platformOf() !== 'darwin') {
    if (secretsBackend() === 'secret-service') sh('secret-tool', ['clear', ...linux.secretAttrs(SERVICE, account)], { timeout: 8000 });
    for (const f of [encFile(account), dpapiFile(account), fallbackFile(account)]) fs.rmSync(f, { force: true });
    return;
  }
  if (which('security') && !noStore()) {
    sh('security', ['delete-generic-password', '-s', SERVICE, '-a', account]);
    return;
  }
  try {
    fs.unlinkSync(fallbackFile(account));
  } catch {}
}
