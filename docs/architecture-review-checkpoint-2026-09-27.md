# Architectural review checkpoint — 2026-09-27

This note preserves findings from a read-only review of `feature/reference-index` at `3f50478`, compared with fork/upstream `main` at `91922c8` and `checkpoint/reference-index-known-good` at `c0dee66`. It records evidence and decisions for a fresh start from upstream main. It does not assert that any fixes have been implemented.

## Design priorities

Reliability, correctness, least privilege, deterministic mechanical work, small model context/tool surface, maintainability, performance, and minimum custom code. “Mechanical processes do mechanical things.” Foundry documents remain authoritative; the model reasons and communicates.

## Executive decision

Do not continue `feature/reference-index` as-is. Keep the useful ideas (metadata-only reference lookup with provenance, top-level compendium UUID interoperability, targeted document fields), but reintroduce them only after their contracts are defined and tested end to end. A fresh base does **not** cure inherited issues in main.

## Current execution map

Sidebar/chat input → `ChatHandler` → `ConversationEngine` → `SimulacrumCore` / `AIClient.chatWithSystem` → native OpenAI-compatible tool calls → `processToolCallLoop` → `executeToolCalls` → `ToolRegistry` / individual tools → `DocumentAPI` and Foundry → conversation persistence and UI callbacks.

The branch adds `ReferenceIndexService`, `resolve_reference`, `task-tool-router`, automatic read-only pre-resolution, narrowed tool schemas, targeted reads, and a narrated-action retry. `AssetIndexService` and the broad document tools predate the branch.

## High severity findings

1. **A reference match is treated as an answered request (introduced).** `conversation-engine.js:50-110` injects index metadata and passes `tools: null` for the first completion when a source and matches exist. `reference-index-service.js` stores name/type/UUID/provenance/artwork, not AC, HP, descriptions, or other facts. A request for those facts may end without `read_document`. Separate identity resolution from evidence retrieval.
2. **Schema routing is not an execution allowlist (introduced over inherited dispatcher).** `task-tool-router.js` filters advertised schemas, while `tool-execution.js` executes names through the global registry without checking turn-scoped permission. `ChatHandler._executeToolLoop` also retains an all-schema path. Confirmation still protects some mutations; this is a least-privilege contract gap, not proof of a confirmation bypass.
3. **Copy and move lack destructive confirmation classification (inherited).** `tool-permission-manager.js` omits `document_copy` and `document_move`; those tools can create/delete or alter documents. The branch router advertises them for relevant text.
4. **Reference index is stale after initial build (introduced).** `simulacrum.js` starts a rebuild; `reference-index-service.js` has no document/pack change invalidation. Renames, deletion, creation, and artwork changes can leave misleading provenance.
5. **Read-before-modify key omits pack (inherited).** `document-read-registry.js` keys by type and raw ID; reads and writes from distinct packs/world can collide. Use canonical identity including source.
6. **Post-write verification is broken (inherited).** `tool-execution.js` passes a callback where `tool-verification.js` expects a conversation manager; verifier calls `read_document` with `id` rather than required `documentId`, then swallows errors. Remove until reliable or fix against the actual tool contract.

## Medium severity findings

- `task-tool-router.js` infers authority from loose keywords. Treat heuristics only as a way to reduce advertised schemas, with execution enforcement and separate confirmation.
- `reference-index-service.js` picks one detected source and ranks candidates without an explicit ambiguity result or confidence rule. A plausible match is not necessarily the requested document.
- Artwork refinement checks **any** resolver match for an image, not the selected match. Pre-resolution and loop refinement overlap.
- `search_documents` describes content/metadata search, but `DocumentAPI.searchDocuments` defaults to name; it ignores the passed `maxResults`. Broad search and listing are unbounded at the source.
- `read_document` advertises `includeEmbedded` default true, but does not forward it; `DocumentAPI` defaults false and its current world path returns the same object. Examples use obsolete `id`/`name` arguments. Unknown targeted fields silently yield an empty object.
- After tool use, text-only final answers are shown and rejected until the model calls `end_loop`. The repeat-limit path inserts an orphan tool response. Keep diagnostics but make completion consistent.
- Retry/fallback logic spans `ConversationEngine`, tool loop, and `AIClient`. A retry after pre-resolution loses injected context and restores the schema list.
- Large-output compaction saves model tokens but persists full outputs in the conversation flag and may still send full payloads to UI.
- Full compendium UUID support in `read_document` covers top-level records, not a general embedded Foundry UUID.
- Automatic pre-resolution scans the catalog on generic turns and logs user text/context preview at info level.

## Tests and evidence limits

Focused reference/router/read/loop tests: 41 passed. The full unit tier: 72 passed; 2 failed to load because `@playwright/test` was absent in the review checkout. Some branch tests, notably `tests/unit/conversation-reference-resolution.test.mjs`, assert source text rather than executing a turn. No live Foundry v14/D&D5e/Ollama acceptance test was run. Manifest `verified: 14` is not runtime evidence.

Acceptance scenarios to cover before trusting a rebuilt flow: direct no-tool answer; exact source and ambiguous references; broad compendium search; resolve → targeted AC/HP read; existing versus alternative artwork; multi-step read-only; creation/update/ownership/JS/copy/move confirmations; same raw ID across packs; failure/retry; narrated action without call; large output; cancellation, reload, and final UI display.

## Target shape and order

Use one canonical document identity; one reference lookup that returns candidates and explicit ambiguity; one turn-level capability set enforced at execution; separate mutation confirmation; bounded source results; and a consistent final-answer termination rule. Prefer **remove → consolidate → reuse existing code → small fix → new abstraction** when reliability is comparable.

Suggested order after explicit authorization: (1) enforce allowed tools and classify copy/move; (2) repair read identity; (3) reintroduce reference lookup without the tool-free factual-answer shortcut; (4) remove or fix verification; (5) consolidate overlap and retry behavior; (6) cap outputs and invalidate index; (7) prove behavior with whole-turn acceptance tests.

## Preserve

Foundry as authority; compact provenance records; top-level compendium UUID handoff; targeted dot-path reads; existing GM checks and confirmation; cancellation/timeouts and native tool-call parity; separation of model content from UI display. Avoid refactoring inherited large files for appearance alone.

Historical branches remain available: `feature/reference-index` (`3f50478`) and `checkpoint/reference-index-known-good` (`c0dee66`). This restart branch begins at upstream/fork main `91922c8`; this note is its only intentional addition.
