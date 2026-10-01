# V12 assistant prompts and validation

The application loads the latest checked-in version of each prompt. `system.v2`, `ask.v2` and `diagnose_issue.v2` add explicit scope, concise Markdown inside the required JSON field, uncertainty and evidence requirements, and bounded conversation context. Repository content and previous messages stay in user-level context. The privileged system prompt contains the language and tool policy, not a project name or repository instructions.

The engine validates the final schema and evidence references before creating any proposal. The `AnswerStream` decoder emits only the selected top-level human-readable string while a request is running. Streaming prose is provisional; it cannot execute tools or change the engine's release gate. Invalid output gets one repair attempt and then a visible failure. No live production publishing capability is given to the model.

Design references (read 2026-10-01):
- [OpenAI prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering): explicit instructions, structure, relevant context and versioned evaluation.
- [OpenAI agent safety](https://developers.openai.com/api/docs/guides/agent-builder-safety): keep untrusted input outside privileged instructions, constrain structured output, and retain review at action boundaries.

Validation is deterministic: fixture answers, Unicode/chunk-boundary streaming tests, failure/repair tests, secret redaction, proposal path policy, stale hashes, history restoration and concurrent writes. These checks do not demonstrate live-model answer quality. Live provider evaluation and owner review remain separate acceptance steps; no paid model request is required by CI.
