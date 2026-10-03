// The bridge to the Node engine. Inside the desktop shell (Tauri) the window carries `__TAURI__` (withGlobalTauri):
// `engine_run` starts `bid <args>` and streams its NDJSON events as `engine://event`; the final `{type:"result"}`
// comes back as the call's value. In a plain browser there is no engine: `hasEngine()` is false and the screens
// show what needs the desktop app instead of pretending. No npm dependency: the global API is enough here.

export interface EngineEvent { type: string; [k: string]: unknown }
export interface EngineResult { type: 'result'; ok: boolean; data?: unknown; error?: string; code?: string }

/** An engine refusal or failure: `code` is the engine's own (docs/errors.md), `message` its localized text. */
export class EngineError extends Error {
  code: string;
  data: Record<string, unknown> | null;
  constructor(message: string, code: string, data: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.data = data;
  }
}

interface TauriGlobal {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: { listen: (name: string, handler: (e: { payload: { request_id: string; event: EngineEvent } }) => void) => Promise<() => void> };
  dialog?: { open: (opts: Record<string, unknown>) => Promise<string | string[] | null> };
}
const tauri = (): TauriGlobal | null => (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;

/** True inside the desktop app, where the engine can run. */
export const hasEngine = () => tauri() !== null;

let seq = 0;
const requestId = () => `${Date.now().toString(36)}-${(seq += 1)}`;

/**
 * Runs one engine command and returns its `data`. `onEvent` sees every event (steps, progress, logs) as it
 * arrives. A failed command throws EngineError with the engine's code and message.
 */
export async function run<T = unknown>(args: string[], { onEvent, lang }: { onEvent?: (e: EngineEvent) => void; lang?: string } = {}): Promise<T> {
  const api = tauri();
  if (!api) throw new EngineError('The engine runs only in the desktop app.', 'no_engine');
  const id = requestId();
  const stop = onEvent ? await api.event.listen('engine://event', (e) => { if (e.payload?.request_id === id) onEvent(e.payload.event); }) : null;
  let result: EngineResult;
  try {
    result = (await api.core.invoke('engine_run', { requestId: id, args, lang })) as EngineResult;
  } catch (e) {
    throw new EngineError(String(e), 'engine_failed');
  } finally {
    stop?.();
  }
  if (!result || result.ok !== true) throw new EngineError(result?.error || 'error', result?.code || 'error', (result?.data as Record<string, unknown>) ?? null);
  return result.data as T;
}

/** Stops a running command (the engine ends its own child processes). */
export async function cancel(id: string): Promise<boolean> {
  const api = tauri();
  return api ? ((await api.core.invoke('engine_cancel', { requestId: id })) as boolean) : false;
}

const previews = new Map<string, string | null>();
/** A theme's picture (engine/themes/<id>/preview.jpg) as a data URL, read once; null when it has none. */
export async function themePreview(id: string): Promise<string | null> {
  const api = tauri();
  if (!api) return null;
  if (previews.has(id)) return previews.get(id) ?? null;
  let url: string | null = null;
  try {
    url = (await api.core.invoke('theme_preview', { id })) as string | null;
  } catch { /* no picture: the card keeps its gradient */ }
  previews.set(id, url);
  return url;
}

/** The OS folder picker (the desktop shell's dialog plugin); null outside the app or when cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  const api = tauri();
  if (!api?.dialog) return null;
  const r = await api.dialog.open({ directory: true, multiple: false, title });
  return typeof r === 'string' ? r : null;
}

/** The OS file picker for photos; [] outside the app or when cancelled. */
export async function pickPhotos(title: string): Promise<string[]> {
  const api = tauri();
  if (!api?.dialog) return [];
  const r = await api.dialog.open({ multiple: true, title, filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }] });
  return Array.isArray(r) ? r : typeof r === 'string' ? [r] : [];
}
