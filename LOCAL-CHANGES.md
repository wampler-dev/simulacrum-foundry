# Local changes and validation notes

This branch contains a focused prototype for task-scoped tool exposure in Simulacrum.

## Motivation

Testing with a local Qwen3 14B model showed reliable native Foundry tool use when the model received a task-relevant subset of tools, while a broad mixed tool surface produced inconsistent routing (for example choosing schema, asset, or JavaScript tools for a named document search).

The native document tools themselves worked correctly once selected:
- `search_documents` searched world documents and readable compendium packs without importing.
- Search results could be carried into `read_document`.
- Large results could be continued with `read_tool_output`.

## Changes

1. `task-tool-router.js` deterministically composes a toolbox from the latest user request.
2. `ConversationEngine.processTurn()` selects the toolbox once and reuses it for the initial request, correction retries, and the autonomous tool loop.
3. The standard English system prompt now uses the registered tool names and adds purpose-based guidance:
   - named content: `search_documents`
   - details: `read_document`
   - schema inspection only when structure is needed
   - resolve documents before associated assets
   - prefer purpose-built tools over `run_javascript`
   - read large stored outputs in <=200-line chunks
   - inspect compendium content in place rather than importing it

## Manual regression prompts

### Research
> Search my available documents and compendiums for Goblin and tell me which sources contain it.

Expected first tool: `search_documents`.

### Research + asset
> Find the Goblin Warrior from the D&D Monster Manual and find an appropriate goblin token or portrait for it. Do not modify anything.

Expected workflow: resolve the document with document tools before selecting an asset.

### Read/reason
> Tell me about the Goblin from the D&D Monster Manual. Give me its main combat strengths and weaknesses and explain how you would run it effectively in an encounter.

Expected workflow: `search_documents` -> `read_document`; if the read is compacted, continue with `read_tool_output` as needed.

## Scope intentionally deferred

Large structured-document summarization/extraction is a separate problem and is not addressed by this branch.
