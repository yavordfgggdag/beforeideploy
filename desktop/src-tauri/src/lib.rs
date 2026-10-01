//! Before I Deploy desktop shell (Tauri 2). The web view talks to the Node engine only through the commands
//! below; it never gets a generic shell. Engine output is NDJSON; every line is forwarded as an
//! `engine://event` to the window and the final `{"type":"result"}` object is returned to the caller.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// Engine sub-commands the UI may run. Anything else is refused before a process is started.
pub const ENGINE_COMMANDS: &[&str] = &[
    "account", "ai", "aifix", "audit", "backup", "billing", "budget", "check", "cloud", "costs", "demo", "deploy",
    "detect", "doctor", "features", "fix", "git", "history", "hosting", "issues", "launch", "local", "logs",
    "monitor", "netlify", "new", "overview", "prices", "project", "release", "report", "setup", "smart",
    "spaceship", "status", "update", "usage", "version",
];

/// Keychain accounts the UI may read/write (service "BeforeIDeploy"); never arbitrary names.
pub const SECRET_ACCOUNTS: &[&str] = &["anthropic", "openai", "netlify", "spaceship", "pushover", "session"];
const SERVICE: &str = "BeforeIDeploy";

#[derive(Default)]
pub struct Running(Mutex<HashMap<String, Arc<Mutex<Child>>>>);

#[derive(Clone, Serialize)]
struct EngineEvent {
    request_id: String,
    event: Value,
}

/// Validates the argument list: known sub-command, no NUL bytes, bounded size, and no secrets as flags
/// (keys travel through the keychain, never argv — the engine refuses them too).
pub fn validate_args(args: &[String]) -> Result<(), String> {
    let first = args.first().ok_or("no engine command")?;
    if !ENGINE_COMMANDS.contains(&first.as_str()) {
        return Err(format!("engine command not allowed: {first}"));
    }
    if args.len() > 64 || args.iter().any(|a| a.len() > 4096 || a.contains('\0')) {
        return Err("invalid engine arguments".into());
    }
    let secret_flags = ["--key", "--token", "--password", "--secret", "--api-key"];
    if args.iter().any(|a| secret_flags.iter().any(|f| a == f || a.starts_with(&format!("{f}=")))) {
        return Err("secrets are not accepted as arguments".into());
    }
    Ok(())
}

/// Where the engine lives: BID_ENGINE_DIR (development) → bundled resource → the repository next to the sources.
pub fn engine_dir(resource_dir: Option<PathBuf>) -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("BID_ENGINE_DIR").map(PathBuf::from),
        resource_dir.map(|r| r.join("engine")),
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../engine")),
    ];
    candidates.into_iter().flatten().find(|d| d.join("src").join("bid.mjs").is_file())
}

/// The Node binary: BID_NODE → the runtime bundled with the engine → `node` on PATH.
pub fn node_bin(engine: &Path) -> PathBuf {
    if let Some(n) = std::env::var_os("BID_NODE") {
        return PathBuf::from(n);
    }
    // the engine's runtime key is Node's "<platform>-<arch>" (darwin-arm64, linux-x64, win32-x64);
    // older macOS bundles used "arm64" / "x86_64"
    let os = if cfg!(target_os = "macos") { "darwin" } else if cfg!(windows) { "win32" } else { "linux" };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x64" };
    let legacy = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
    let exe = if cfg!(windows) { "node.exe" } else { "node" };
    let rt = engine.join("runtime");
    [rt.join(format!("{os}-{arch}")), rt.join(legacy)]
        .into_iter()
        .flat_map(|d| [d.join("bin").join(exe), d.join(exe)])
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(exe))
}

/// Runs the engine and calls `on_event` for every NDJSON line; returns the final result object.
pub fn run_engine(engine: &Path, args: &[String], slot: Option<&Arc<Mutex<Option<Arc<Mutex<Child>>>>>>, mut on_event: impl FnMut(Value)) -> Result<Value, String> {
    validate_args(args)?;
    let mut cmd = Command::new(node_bin(engine));
    cmd.arg(engine.join("src").join("bid.mjs")).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.env("BID_CLIENT", "desktop");
    let mut child = cmd.spawn().map_err(|e| format!("could not start the engine: {e}"))?;
    let stdout = child.stdout.take().ok_or("no engine output")?;
    let child = Arc::new(Mutex::new(child));
    if let Some(s) = slot {
        *s.lock().unwrap() = Some(child.clone());
    }
    let mut result = Value::Null;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(ev) = serde_json::from_str::<Value>(&line) else { continue };
        if ev.get("type").and_then(Value::as_str) == Some("result") {
            result = ev.clone();
        }
        on_event(ev);
    }
    let status = child.lock().unwrap().wait().map_err(|e| e.to_string())?;
    if result.is_null() {
        return Err(format!("the engine ended without a result (exit {:?})", status.code()));
    }
    Ok(result)
}

#[tauri::command]
async fn engine_run(app: AppHandle, running: State<'_, Running>, request_id: String, args: Vec<String>) -> Result<Value, String> {
    validate_args(&args)?;
    let engine = engine_dir(app.path().resource_dir().ok()).ok_or("engine not found")?;
    let slot: Arc<Mutex<Option<Arc<Mutex<Child>>>>> = Arc::new(Mutex::new(None));
    let (app2, rid, slot2) = (app.clone(), request_id.clone(), slot.clone());
    let task = tauri::async_runtime::spawn_blocking(move || {
        run_engine(&engine, &args, Some(&slot2), |event| {
            let _ = app2.emit("engine://event", EngineEvent { request_id: rid.clone(), event });
        })
    });
    // register for cancellation once the process exists
    for _ in 0..50 {
        if let Some(c) = slot.lock().unwrap().clone() {
            running.0.lock().unwrap().insert(request_id.clone(), c);
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let out = task.await.map_err(|e| e.to_string())?;
    running.0.lock().unwrap().remove(&request_id);
    out
}

#[tauri::command]
fn engine_cancel(running: State<'_, Running>, request_id: String) -> bool {
    match running.0.lock().unwrap().remove(&request_id) {
        Some(c) => c.lock().unwrap().kill().is_ok(),
        None => false,
    }
}

fn entry(account: &str) -> Result<keyring::Entry, String> {
    if !SECRET_ACCOUNTS.contains(&account) {
        return Err(format!("unknown secret account: {account}"));
    }
    keyring::Entry::new(SERVICE, account).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_set(account: String, value: String) -> Result<(), String> {
    entry(&account)?.set_password(&value).map_err(|e| e.to_string())
}

/// Only reports whether a secret exists — the value never goes back to the web view.
#[tauri::command]
fn secret_exists(account: String) -> Result<bool, String> {
    match entry(&account)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_delete(account: String) -> Result<(), String> {
    match entry(&account)?.delete_credential() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Running::default())
        .invoke_handler(tauri::generate_handler![engine_run, engine_cancel, secret_set, secret_exists, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running Before I Deploy");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_unknown_commands_and_secret_flags() {
        assert!(validate_args(&["rm".into(), "-rf".into()]).is_err());
        assert!(validate_args(&[]).is_err());
        assert!(validate_args(&["check".into(), "--token=abc".into()]).is_err());
        assert!(validate_args(&["check".into(), "--key".into(), "x".into()]).is_err());
        assert!(validate_args(&["check".into(), "a\0b".into()]).is_err());
        assert!(validate_args(&["version".into()]).is_ok());
    }

    #[test]
    fn secret_accounts_are_allowlisted() {
        assert!(entry("../etc").is_err());
        assert!(entry("anthropic").is_ok());
    }

    #[test]
    fn runs_the_engine_and_returns_the_result() {
        let engine = engine_dir(None).expect("engine next to the sources");
        let mut events = 0;
        let r = run_engine(&engine, &["version".into()], None, |_| events += 1).expect("engine ran");
        assert_eq!(r.get("ok").and_then(Value::as_bool), Some(true), "{r}");
        assert!(events >= 1);
    }
}
