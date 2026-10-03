// Before I Deploy — which AI engine answers a cloud request: Claude (Anthropic Messages API, the default) or
// Codex (OpenAI Chat Completions). Both keys live only in Supabase secrets; the owner's account picks the
// engine per request (`engine` in the body), the Admin panel picks the models per plan for each engine.
// Everything here is shared by `ai-fix` (streamed text) and `site-gen` (structured JSON steps).

export type CloudEngine = "claude" | "codex";
export const ENGINES: CloudEngine[] = ["claude", "codex"];

/** The engine a request asks for; anything unknown or missing is Claude. */
export const engineOf = (v: unknown): CloudEngine => (v === "codex" ? "codex" : "claude");

/** Models per plan on Codex (Admin panel: `ai.modelsCodex`), the same shape as `ai.models` for Claude. */
export const DEFAULT_CODEX_MODELS: Record<string, string> = { flash: "gpt-5-mini", high: "gpt-5", knight: "gpt-5", deep: "gpt-5", explain: "gpt-5-mini", fast: "gpt-5-mini" };

/** USD per million tokens (input / output) for the Codex models — bookkeeping and the credit price, like `ai.prices`. */
export const DEFAULT_CODEX_PRICES: Record<string, [number, number]> = { "gpt-5": [1.25, 10], "gpt-5-mini": [0.25, 2], "gpt-5-nano": [0.05, 0.4] };

/** The model map for an engine from the settings table (Claude: `ai.models`; Codex: `ai.modelsCodex`). */
export function modelsFor(settings: Record<string, unknown>, engine: CloudEngine): Record<string, string> {
  if (engine === "codex") return { ...DEFAULT_CODEX_MODELS, ...((settings["ai.modelsCodex"] as Record<string, string>) ?? {}) };
  return (settings["ai.models"] as Record<string, string>) ?? {};
}

export interface EngineKeys {
  anthropicKey: string;
  anthropicBase: string;
  openaiKey?: string;
  openaiBase?: string;
}

/** Whether the engine's key is configured on this project. */
export const engineConfigured = (deps: EngineKeys, engine: CloudEngine) => (engine === "codex" ? !!deps.openaiKey : !!deps.anthropicKey);

/** Claude's effort levels → OpenAI's `reasoning_effort`. */
const reasoning = (effort: string) => (effort === "low" ? "low" : effort === "xhigh" || effort === "high" ? "high" : "medium");

export interface ModelRequest {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  effort: string;
  /** structured output: a JSON schema the answer must follow */
  schema?: unknown;
}

/**
 * The upstream request for an engine: URL, headers and body. Both stream, both report the token counts in the
 * stream, so the handlers bill the same way whichever engine answered.
 */
export function upstreamRequest(deps: EngineKeys, engine: CloudEngine, p: ModelRequest): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
  if (engine === "codex") {
    const body: Record<string, unknown> = {
      model: p.model,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: p.maxTokens,
      messages: [{ role: "system", content: p.system }, { role: "user", content: p.prompt }],
      reasoning_effort: reasoning(p.effort),
    };
    if (p.schema) body.response_format = { type: "json_schema", json_schema: { name: "answer", schema: p.schema } };
    return { url: `${deps.openaiBase ?? "https://api.openai.com"}/v1/chat/completions`, headers: { "content-type": "application/json", authorization: `Bearer ${deps.openaiKey ?? ""}` }, body };
  }
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: p.maxTokens,
    system: p.system,
    messages: [{ role: "user", content: p.prompt }],
    stream: true,
  };
  const haiku = /haiku/i.test(p.model);
  if (p.schema) body.output_config = { format: { type: "json_schema", schema: p.schema }, ...(haiku ? {} : { effort: p.effort }) };
  else if (!haiku) body.output_config = { effort: p.effort };
  return { url: `${deps.anthropicBase}/v1/messages`, headers: { "content-type": "application/json", "x-api-key": deps.anthropicKey, "anthropic-version": "2023-06-01" }, body };
}

/** One normalized event from either stream. `stop`: `end` | `truncated` | `refused` | `error`. */
export interface StreamEvent { text?: string; input?: number; output?: number; model?: string; stop?: "end" | "truncated" | "refused" | "error"; errorDetail?: string }

/** Turns one parsed SSE JSON object from the engine's stream into normalized events (none for pings etc). */
export function parseStreamEvent(engine: CloudEngine, j: Record<string, unknown>): StreamEvent[] {
  const out: StreamEvent[] = [];
  if (engine === "codex") {
    if (j.error) return [{ stop: "error", errorDetail: JSON.stringify(j.error).slice(0, 300) }];
    const choice = (j.choices as { delta?: { content?: string }; finish_reason?: string | null }[] | undefined)?.[0];
    const text = choice?.delta?.content;
    if (typeof j.model === "string") out.push({ model: j.model });
    if (text) out.push({ text });
    if (choice?.finish_reason) out.push({ stop: choice.finish_reason === "length" ? "truncated" : choice.finish_reason === "content_filter" ? "refused" : "end" });
    const u = j.usage as { prompt_tokens?: number; completion_tokens?: number } | null | undefined;
    if (u && (u.prompt_tokens != null || u.completion_tokens != null)) out.push({ input: u.prompt_tokens ?? undefined, output: u.completion_tokens ?? undefined });
    return out;
  }
  const type = j.type as string;
  if (type === "message_start") {
    // the input count is final here; the output count arrives with message_delta (a reported count, never this placeholder)
    const m = j.message as { usage?: { input_tokens?: number }; model?: string };
    out.push({ input: m.usage?.input_tokens ?? 0, model: m.model });
  } else if (type === "content_block_delta") {
    const d = j.delta as { type?: string; text?: string };
    if (d.type === "text_delta" && d.text) out.push({ text: d.text });
  } else if (type === "message_delta") {
    const u = j.usage as { output_tokens?: number } | undefined;
    const stop = (j.delta as { stop_reason?: string })?.stop_reason;
    out.push({ output: u?.output_tokens ?? undefined, stop: stop === "refusal" ? "refused" : stop === "max_tokens" ? "truncated" : stop ? "end" : undefined });
  } else if (type === "error") {
    out.push({ stop: "error", errorDetail: JSON.stringify(j.error ?? {}).slice(0, 300) });
  }
  return out;
}

/** Splits an SSE body into its `data:` payloads as they arrive; `[DONE]` (OpenAI) ends the stream. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data) continue;
      if (data === "[DONE]") return;
      try { yield JSON.parse(data); } catch { /* keep-alive or partial line */ }
    }
  }
}
