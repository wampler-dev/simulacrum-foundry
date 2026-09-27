# Stabilization development plan

Status: **Required scope; C1, C2, and H1 owner-accepted. H7 mitigation awaiting live validation and owner acceptance. Other tasks remain unauthorized.**
Owner: wampler-dev
Adopted: 2026-09-27
Branch: `restart/from-upstream-main`
Reviewed code baseline: `91922c835dc6d269a35c2475a8f4de4a385aa616`
Reviewed restart commit: `8a58fa9d2f913a2e99aded48106571a8bb7050dc` (baseline plus historical checkpoint note).

## Binding scope and authorization

This plan is the sole development priority until every finding below has an explicit, evidence-backed resolution accepted by the owner. Do not explore or pursue other development goals in the meantime. **Only the owner's explicit permission allows a new task.** Completion of this plan does not automatically authorize subsequent work.

Recording this plan authorizes documentation only. It does not authorize implementation, code changes, dependency changes, feature restoration, or remediation commits. Obtain explicit owner authorization for a concrete task before starting implementation. Authorization for one task does not authorize the rest of the backlog. Read-only inspection and verification necessary to complete an already authorized task remain within that task.

Newly discovered issues may be recorded as blocked candidates; do not silently expand scope or begin work on them. If they block an authorized task, explain the dependency and seek explicit authorization. Do not use refactoring, cleanup, performance work, or test expansion as a route around this rule.

A finding is resolved by a verified fix, removal, consolidation, or an owner-accepted decision to leave it alone supported by evidence. An investigation is not resolved merely because it has been assigned, deferred, or covered by a passing unit test.

## Engineering priorities

1. Reliability.
2. Correctness.
3. Least privilege and safe tool use.
4. Deterministic mechanical processing.
5. Minimal model context and unnecessary tool exposure.
6. Maintainability.
7. Performance.
8. KISS and minimum custom code.

**Mechanical processes do mechanical things.** JavaScript handles identity, discovery, routing, validation, parsing, provenance, and bounds. The model interprets, reasons, and communicates. Foundry remains authoritative.

When reliability is comparable, prefer **REMOVE > CONSOLIDATE > REUSE EXISTING CODE > SMALL FIX > NEW ABSTRACTION**. Do not build a new AI framework.

## Architecture and contracts under review

The active path is sidebar input → ChatHandler → ConversationEngine → SimulacrumCore → AIClient's OpenAI-compatible chat completion → autonomous tool loop → tool executor → ToolRegistry → individual tools / DocumentAPI / Foundry → conversation history and UI.

The separate provider classes are not the principal chat transport. ChatInterface initialization was not found on the active path; do not treat its alternate execution code as active without proving a caller. Conversation state and output buffers persist in user flags; diagnostics maintain additional data. Asset indexing is a separate persistent service. Macro discovery can add tools dynamically.

The clean baseline has no ReferenceIndexService, task-scoped router, targeted field reads, or narrated-action correction from the feature branch. The registry exposes 18 built-in tools plus discovered macro tools; the initial schema filter and later loop schema selection differ.

Required contract outcomes:

| Boundary | Required outcome |
| --- | --- |
| Input → turn capabilities → dispatch | One explicit capability set; advertised tools and executable tools agree throughout the turn. |
| Search/resolve → read/write | Canonical identity includes source; no model parsing of display links or reconstruction of pack IDs. |
| Tool schema → implementation | Required fields, defaults, limits, outputs, and error behavior match runtime. |
| Mutation → approval → Foundry | Approval covers the actual target and operation; metadata/origin cannot bypass policy. |
| Tool → executor → history/UI | Consistent success/error semantics; display content is distinct from model evidence. |
| History → compaction → transport | The request uses the newly compacted history and obeys an actual context budget. |
| Model response → loop | Real calls execute; prose is never represented as completed work; completion and failure are unambiguous. |

## Review evidence and limitations

The clean-branch review included source tracing, targeted harmless runtime probes, and available test tiers. Regression: 28 passed plus the standalone compaction-budget script. Integration: 14 passed. Unit: 29 passed; two files failed to load because @playwright/test was unavailable. Security: two passed. Component: one passed.

No live Foundry v14, installed D&D5e, browser exploit, or real Ollama qwen3:14b acceptance run was performed. The manifest's verified-v14 declaration is not runtime proof. The HTML finding requires validation at the real rendering boundary. Passing tests do not establish architectural correctness.

All C/H/M/L findings below are present in the clean baseline, so they are inherited relative to feature/reference-index, not introduced by that feature branch. This establishes baseline provenance, not the historical author or introducing commit. R items preserve feature-branch lessons and are constraints, not authorization to restore those features.

## Critical findings

### C1 — Executable macro configuration discovery
- Category/components: code execution; scripts/core/macro-tool-manager.js, _parseToolConfig and discovery.
- Evidence/path: discovery extracts a JavaScript object literal and evaluates it with new Function. World macros and Macro packs are scanned during GM initialization; expressions run before the enabled check and execution confirmation. A harmless expression probe confirmed execution during parsing.
- Impact: discovering configuration can execute macro code outside the intended approval boundary.
- Disposition: **Remove** executable configuration parsing; use inert data or disable this discovery path until a safe contract exists.
- Closure: configuration containing expressions cannot execute; disabled entries cannot execute during discovery; discovery never invokes a macro.

### C2 — Macro names can replace built-ins and evade classification
- Category/components: authority/registration; macro-tool-manager.js and tool-permission-manager.js.
- Evidence/path: configured names cause existing entries to be unregistered and replaced. Approval classification recognizes static names or the macro_ prefix rather than registered origin metadata. A macro named read_document or an arbitrary non-prefixed name can escape macro classification.
- Impact: advertised read capabilities can acquire executable macro behavior.
- Disposition: **Fix** reserved-name collisions and enforce policy using actual registered capability/origin.
- Closure: built-in replacement is rejected; all macro-backed execution follows macro policy regardless of name.

## High findings

### H1 — Copy/move confirmation is not enforced
- Category/components: permissions; document-copy.js, document-move.js, tool-execution.js, tool-permission-manager.js.
- Evidence/path: tool constructors declare requiresConfirmation, but execution consults isDestructive; its list omits document_copy and document_move. A classification probe confirmed both false.
- Impact: creation/deletion can bypass expected confirmation.
- Disposition: **Consolidate** approval policy into one enforced source.
- Closure: denial prevents every side effect; copy and move follow approved mutation policy through the real dispatcher.

### H2 — Copy/move error paths call a nonexistent method
- Category/components: recovery; document-copy.js, document-move.js, base-tool.js.
- Evidence/path: tools call createErrorResponse; BaseTool provides handleError instead. Runtime inspection confirmed the referenced method is absent. Move can copy first and then fail during deletion.
- Impact: the original failure is replaced by TypeError and partial changes are obscured.
- Disposition: **Small fix** using the established error contract.
- Closure: representative failures return the original cause and accurately report any partial result.

### H3 — Embedded compendium updates lose pack identity
- Category/components: target correctness; document-update.js and document-api.js.
- Evidence/path: planning reads a pack document, but embedded application passes type/id/operations without pack. applyEmbeddedOperations resolves a world collection.
- Impact: a same-ID world document may be mutated instead of the approved pack document.
- Disposition: **Fix** target preservation; reject unsupported targets before side effects.
- Closure: same-ID world/pack fixtures prove only the selected target changes; unsupported pack operations fail safely.

### H4 — Read-before-modify registry omits source
- Category/components: identity; utils/document-read-registry.js and document read/update/delete tools.
- Evidence/path: keys use type:rawId; pack identity is omitted.
- Impact: reading one source can satisfy the read prerequisite for a different source.
- Disposition: **Consolidate** on canonical document identity.
- Closure: world and two packs sharing a raw ID remain distinct for read, update, and delete checks.

### H5 — Initial compaction does not replace the outgoing history
- Category/components: state/context; conversation-engine.js, simulacrum-core.js, conversation.js.
- Evidence/path: the engine supplies the active array; compaction replaces that array in the manager; initial generation retains the original reference. The loop rereads history and behaves differently.
- Impact: stale large history can be sent alongside the new summary.
- Disposition: **Small fix** using the authoritative post-compaction state.
- Closure: inspect the actual outbound request after forced compaction; removed history is absent and summary appears once.

### H6 — Default capability exposure is too broad
- Category/components: least privilege/context; simulacrum-core.js, conversation-engine.js, tool loop and executor.
- Evidence/path: general turns receive the registered capability surface; loop schema selection can restore broader exposure.
- Impact: irrelevant discovery, mutation, ownership, and executable tools compete with the requested task.
- Disposition: **Simplify** to a minimal capability set with dispatcher enforcement. Avoid a large keyword intent framework.
- Closure: read-only/no-tool tasks cannot execute mutation or arbitrary code; the allowed set survives continuation, retries, and compaction.

### H7 — HTML rendering boundary is not proven safe
- Category/components: UI trust; lib/markdown-renderer.js, utils/message-utils.js, ui/simulacrum-sidebar-tab.js.
- Evidence/path: DOMParser repair is not sanitization; raw-HTML paths exist, justification is interpolated into markup, and a streaming insertion path conditionally uses DOMPurify. Existing security tests exercise a different sanitizer helper.
- Impact: model/tool content may reach an unsafe HTML sink. Exploitability in the live Foundry rendering chain remains unverified.
- Disposition: **Investigate further**, then fix the actual boundary if confirmed.
- Closure: behavioral browser tests cover final and streaming content, tool descriptions/justifications, and malicious attributes/URLs; establish any downstream sanitization rather than assume it.

## Medium findings

| ID | Category / components | Evidence and affected path | Why it matters / disposition | Closure evidence |
| --- | --- | --- | --- | --- |
| M1 | Search contract; document-search.js, document-api.js | Schema describes content/all-field search; API defaults to name. Passed maxResults is ignored. | Misleading and unbounded search; **Fix** schema/runtime agreement and source limits. | Actual matching semantics and limits tested across world/packs, including empty and broad queries. |
| M2 | Read contract/context; document-read.js, document-api.js | Full data serialization; includeEmbedded not forwarded, conflicting defaults, ineffective API distinction. Pagination is over serialized JSON lines. | Excessive context and unreliable advertised behavior; **Simplify/Fix** bounded selected reads and honest semantics. | Exact fields, missing fields, embedded inclusion, and bounded results tested against real-shaped documents. |
| M3 | Identity handoff; base-tool.js, search/read tools | Search emits formatted UUID links plus raw identity; extractRawId handles wrappers but leaves bare full UUID unchanged; pack handoff is separate. | The model performs mechanical identity translation; **Reuse/Fix** deterministic identity handling. | Search result identity is directly consumable by read; supported top-level/embedded UUID behavior is explicit. |
| M4 | Verification; tool-execution.js, tool-verification.js | Callback supplied where manager expected; verifier looks for top-level IDs while tools nest document results; read arguments use id instead of documentId; failures swallowed. Create/update already read back internally. | False assurance and duplication; **Remove** generic verifier first, retain useful existing readback. | No claim of verification without actual evidence; mutation results are checked at the authoritative boundary. |
| M5 | Completion; tool-loop-handler.js | Text-only response accepted initially but after tool use is displayed/saved then rejected until end_loop. | Extra rounds and contradictory completion; **Consolidate** one completion rule. | No-tool and post-tool final answers terminate once without duplicate UI/history or corrective churn. |
| M6 | Retry/recovery; conversation-engine.js, tool-loop-handler.js, ai-client.js | Retry/correction/fallback responsibility spans layers; plain prose fallback can follow missing evidence. | Unclear terminal failure and repeated effort; **Consolidate** ownership and explicit failure outcomes. | Transport failure, tool failure, denial, cancellation, and exhaustion produce truthful bounded outcomes. |
| M7 | Output/state; tool-execution.js, conversation.js | Output buffering around 1,000 tokens retains complete content, persists the buffer in flags, and can send full UI payloads. | Model compaction does not bound storage/UI costs; **Fix** source limits and bounded retained state. | Large search/read/output tests measure outbound size, persistence, pagination, reload, and UI behavior. |
| M8 | Result envelope; tool-registry.js, tool-execution.js | Registry success counters include returned error results; executor uses !result.error; outputs mix JSON strings, HTML, and prose. | Metrics and downstream consumers disagree; **Consolidate** a small explicit result contract. | Returned failure, thrown failure, partial success, and success agree across registry, executor, history, and UI. |
| M9 | Move/copy semantics; document-move.js, document-copy.js | Move is copy then delete then text-result parsing; embedded copy invents embedded_copied as an ID. | Non-atomic partial state and invalid identity; **Simplify/Remove** unsupported cases, use actual returned documents. | Failure after copy reports real destination and source state; no fabricated IDs or silent repeat copies. |
| M10 | Asset service complexity; asset-index-service.js | Global FilePicker upload/createDirectory patching, recursive root traversal, IndexedDB cursor searches. | Lifecycle/performance costs need measurement; **Investigate further**, provisionally leave alone. | Representative index size, upload updates, interrupted rebuild/reload, search latency and stale results assessed. No aesthetic rewrite. |
| M11 | Prompt context; system-prompt-builder.js | Macro lists and legacy schema descriptions are included beyond task need. | Duplicated/unnecessary context; **Remove/Consolidate** with the actual allowed schema surface. | Inspect outgoing requests in native and supported fallback modes; only required descriptions remain. |

## Low findings and bounded investigations

| ID | Components / evidence | Disposition and closure |
| --- | --- | --- |
| L1 | Alternate ChatHandler response/execution flows; dormant ChatInterface and ConfirmationDialog | **Investigate/Remove** only after checking initialization, callers, and extension consumers. Establish one supported path; document any retained public contract. |
| L2 | DocumentRead prepareDocumentData/processReferences are not used by execute; examples retain obsolete id/name arguments | **Remove/Fix** dead helpers and misleading examples after caller verification. Schema examples must execute successfully. |
| L3 | DocumentAPI generic reflection and mock-friendly fallbacks | **Leave alone** unless a concrete runtime failure is reproduced. Record supported Foundry/schema behavior; do not restructure the large file for appearance. |
| L4 | Loop default 100 with an unlimited option | **Investigate/Small fix** based on bounded completion behavior. Set an explicit owner-accepted operational budget; prove cancellation and exhaustion. |
| L5 | Logging retains full arguments/results in addition to conversation storage | **Simplify** to useful diagnostics with bounded payloads and an explicit debug policy. Verify normal operation avoids unnecessary duplicate persistence. |

## Feature-branch lessons that constrain this plan

See [historical review checkpoint](architecture-review-checkpoint-2026-09-27.md). It is historical, not the current implementation plan.

- R1: A reference match supplies identity/provenance, not document facts. Never disable required reads merely because a catalog matched.
- R2: Schema filtering is not authority enforcement; capability checks belong at dispatch.
- R3: Any future metadata index requires invalidation and explicit ambiguity/no-match results.
- R4: Existing artwork must belong to the selected candidate; one candidate's image cannot suppress another candidate's legitimate asset search.
- R5: Tool results must say what evidence was returned and what was displayed; do not imply that internal output was shown to the user.
- R6: Narration of an intended action is not an executed action. Retry behavior must remain bounded and must not fabricate success.
- R7: Do not restore overlapping pre-resolution, routing, post-resolution refinement, and corrective prompt mechanisms wholesale. Prove the smallest necessary contract first.

Resolution of these constraints means the applicable acceptance scenarios pass and the owner accepts the design. It does not require restoring ReferenceIndexService or any feature-branch implementation.

## Ordered remediation stages

Each stage is a planning group, **not blanket authorization**. Select concrete tasks with the owner.

1. **Close execution and approval gaps:** C1, C2, H1; assess H7 at the real rendering boundary. Prefer disabling/removing unsafe behavior over replacing it with another framework.
2. **Restore target and result correctness:** H2, H3, H4, M3, M4, M8, M9. Canonical identity must precede mutation acceptance.
3. **Establish bounded evidence retrieval and state:** H5, M1, M2, M7. Prove exact source → read required evidence → final response before rebuilding discovery.
4. **Constrain capabilities and finish turns predictably:** H6, M5, M6, M11, L4; apply R1–R7 without wholesale branch restoration.
5. **Resolve remaining measured debt:** M10, L1, L2, L3, L5, plus every open investigation. An accepted leave-alone result is valid; silent deferral is not.
6. **Run acceptance and owner review:** exercise all scenarios below in the supported environment; attach evidence and obtain explicit closure. No unrelated feature development follows automatically.

## Acceptance matrix

Behavioral acceptance tests are required where they establish cross-component contracts. Source-text assertions may check structure but cannot substitute for running the flow. Do not add tests that merely mirror implementation.

| Scenario | Required observable outcome |
| --- | --- |
| A. Direct information, no tool needed | One final response; no unnecessary discovery or tools. |
| B. Exact named reference with source | Selected identity preserves the requested source; factual response uses document evidence. |
| C. Ambiguous name without source | Explicit candidates or clarification; no silent arbitrary selection. |
| D. Broad compendium search | Honest search semantics, bounded results, usable continuation. |
| E. Reference → selected fields | Deterministic identity handoff and only required fields returned. |
| F. Reference → existing artwork | Uses artwork from selected document; no redundant search. |
| G. Reference → alternative artwork | Explicit alternative request can search assets despite existing artwork. |
| H. Multi-step read-only | Required reads work; mutation/ownership/code remain unavailable at dispatch. |
| I. Creation | Correct target/type; approval enforced; actual result identity returned. |
| J. Modification | Prior-read identity and source agree; embedded/world/pack targets cannot cross. |
| K. Ownership | Explicit authorization/confirmation, accurate permissions and denied-case behavior. |
| L. JavaScript/macro | Available only when explicitly authorized; discovery never executes code; naming cannot bypass policy. |
| M. Failure/retry | Bounded retry, truthful error/partial-state reporting, no duplicate side effects. |
| N. Narration without a call | No executed-action claim; bounded recovery or explicit inability. |
| O. Large output | Bounded source results, usable paging, correct compaction, bounded persistence and UI. |
| P. Cancellation, denial, reload | No later unwanted execution; history and state remain coherent. |
| Q. Same ID across sources | World and multiple pack documents remain distinct throughout reads and mutations. |
| R. UI trust and presentation | Streaming/final/tool content is safe and visible exactly as claimed to model/user. |

Run relevant acceptance against Foundry v14, the installed D&D5e version, and Ollama qwen3:14b through the actual configured OpenAI-compatible transport. Record versions and settings. Generic Foundry behavior must not depend on unverified D&D5e field assumptions; system-specific fields require schema-backed validation. Mock tests cannot certify host permissions, embedded-document behavior, UI sanitation, or actual model tool-call behavior.

## Do not change without a demonstrated need

- Foundry documents and permissions as the authoritative state.
- Working GM gating, mutation confirmation, cancellation, and request timeouts; repair gaps without discarding safeguards.
- Working native tool-call normalization and parity.
- Separation of model evidence from user-facing display.
- Existing useful create/update readback; remove broken duplicate verification instead.
- Asset indexing architecture solely because it is complex; measure the concrete problem first.
- Large files, generic schema reflection, or provider abstractions solely for stylistic purity.
- Historical feature/checkpoint branches; preserve them as evidence, not as code to cherry-pick wholesale.

## Resolution record

All C1–C2, H1–H7, M1–M11, L1–L5, and applicable R1–R7 constraints are **open** when this plan is adopted. None is marked fixed by publication of this document.

For each authorized task, record:
- Finding IDs and exact owner authorization/scope.
- Disposition and minimal change or investigation.
- Commit(s), if implementation was authorized.
- Behavioral evidence and environment; remaining limitations.
- Any decision to retain/remove functionality and owner's acceptance.
- Final status: open, in progress, awaiting owner acceptance, or resolved.

No scope expansion and no new task without the owner's explicit permission.


### C1 implementation — 2026-09-27

- Authorization: owner said “Great, then let's start!” after adoption of this plan. Work was explicitly scoped in the response to the first task, C1; no blanket authorization was inferred.
- Disposition: **Remove/disable** automatic macro-tool discovery. Deleted source evaluation, world/pack scanning, lifecycle discovery hooks, and the now-unused dynamic registration helpers. Kept a small inert manager API for existing module/permission UI consumers.
- Behavior change: macros with a const tool configuration no longer become custom AI tools. Existing macro documents and the explicit execute_macro tool are unchanged. README now documents this and requires a Foundry reload to discard previous in-memory tools/hooks.
- Evidence: two behavioral security tests ran against the original code and both failed, observing configuration expression execution for enabled and disabled macros in world/pack discovery. The same tests now pass with zero evaluations, macro executions, pack loads, registrations, or discovery hooks during initialization and refresh.
- Verification: security tier 4/4 passed; local integration tier 14/14 passed; required-test policy and git diff whitespace checks passed. No live Foundry/D&D5e/Ollama acceptance was performed.
- Implementation commit: [d40406096d5c485a494b44ddc20597c4ddcdf825](https://github.com/wampler-dev/simulacrum-foundry/commit/d40406096d5c485a494b44ddc20597c4ddcdf825).
- Remaining: C2's registration path was removed as a consequence of disabling discovery, but C2 is not declared resolved; its final disposition and any future restoration require separate owner authorization. No other finding is claimed fixed.
- Owner acceptance: on 2026-09-27, the owner stated “I approve. Track the changes you make in our development plan. Once done, let me know.” following the C1 completion report.
- Status: **Resolved by owner-approved removal**. Live Foundry/D&D5e/Ollama validation remains outstanding and is not claimed by this closure. All other findings retain their prior status; this acceptance does not authorize C2 or another implementation task.


### C2 verification and disposition — 2026-09-27

- Authorization: owner said “Please continue.” after the report explicitly identified C2 as the next task awaiting authorization. Work was scoped to C2.
- Disposition: **Remove**, reusing C1's removal in d40406096d5c485a494b44ddc20597c4ddcdf825. No additional application code or registration abstraction is needed. The former macro manager unregistered built-ins before registering macro-defined replacements; that entire registration path is gone. The retained manager cannot scan, register, or execute macros.
- Existing mechanism retained: ToolRegistry already rejects duplicate registered names. The explicit execute_macro tool remains classified as destructive by its tool identity, independently of the target macro's name. This is not a claim that the registry is a sandbox against trusted JavaScript calling its public registration API.
- Changes in this task: added tests/security/macro-registration.test.mjs and this plan entry in commit [807f6f3b3ffb0b38e34d7882f0ccb6de6acd3d0d](https://github.com/wampler-dev/simulacrum-foundry/commit/807f6f3b3ffb0b38e34d7882f0ccb6de6acd3d0d).
- Behavioral evidence: three scenarios use the real ToolRegistry and default tools with world/pack macro configurations named read_document, execute_macro, and unprefixed_custom_tool. Initialization and refresh preserve the built-in instances and advertised schemas, register no custom tools, and execute no macros. Duplicate registration is rejected by the existing registry.
- Dispatch evidence: the real executeToolCalls dispatcher, permission manager, and registered ExecuteMacroTool are exercised with an explicit deny setting. Target names read_document and unprefixed_custom_tool both produce denied history/results with zero macro lookups or executions. Only diagnostic logging is mocked; Foundry globals are fixtures.
- Verification: security tier **8/8 passed** (four new C2 checks); required-test policy and whitespace checks passed. These are Node behavioral tests, not live Foundry or browser approval-dialog tests. No claim is made about unresolved general capability-routing findings.
- Restoration constraint: automatic custom macro tools must remain disabled. Any future restoration needs separately authorized inert configuration, collision protection, and execution policy based on actual tool origin/capability; the former naming convention is insufficient.
- Owner acceptance: on 2026-09-27, the owner stated “Accepted. Document and continue please.” after the C2 evidence and removal disposition were presented.
- Status: **Resolved by owner-approved removal**. No other finding was closed by this acceptance.

### H1 implementation — 2026-09-27

- Authorization: the same owner message expressly directed continued work after acceptance of C2; the preceding report identified H1 as the next planned task. Work was scoped to H1.
- Disposition: **Small fix in the existing policy source**. Added document_copy and document_move to DESTRUCTIVE_TOOL_META in scripts/core/tool-permission-manager.js. The executor already consults isDestructive before ToolRegistry execution, so both tools now use the existing deny/ask/allow path. Added permission UI labels and descriptions in lang/en.json. No new policy mechanism was introduced.
- Behavioral evidence: eight tests in tests/security/copy-move-permissions.test.mjs exercise the actual executeToolCalls dispatcher and permission manager for copy and move with deny setting, confirmation denied, confirmation allowed, and explicit allow setting. Both tools are listed in the existing permission UI source. The test intercepts registry execution as the mutation boundary and asserts zero invocations for denied cases and exactly one for allowed cases. All six original deny/confirmation cases failed before the policy change and passed afterward.
- Verification: security tier **16/16 passed**; local integration tier **14/14 passed**; policy tier passed; git whitespace check passed. Static tier could not complete in this checkout because the ESLint baseline tool received empty JSON output when development dependencies were not installed. No live Foundry v14/D&D5e confirmation dialog or copy/move document mutation was run.
- Limits: H2 and M9 still cover copy/move error handling, partial moves, and result identity. H1 tests establish the dispatcher policy boundary, not correctness of those tool implementations or a live browser prompt.
- Commit: the commit containing this entry and H1 change is titled “fix: require permission for document copy and move (H1)”.
- Implementation commit: [3296b39f6a2053f631d46e393eba82201ad0854e](https://github.com/wampler-dev/simulacrum-foundry/commit/3296b39f6a2053f631d46e393eba82201ad0854e).
- Owner acceptance: on 2026-09-27, the owner stated “I approve. Please document and proceed.” following the H1 report.
- Status: **Owner-accepted fix; live validation outstanding**. No other finding was closed by this acceptance.

### H7 boundary mitigation — 2026-09-27

- Authorization: the same owner message directed continued work after H1 acceptance. The plan's first stage calls for assessing H7 before moving to the next stage. Work was scoped to the UI trust boundary.
- Confirmed path: MarkdownRenderer.render returns HTML-looking input unchanged by default. sidebar-state-syncer passes generated/enriched HTML into display strings; message.hbs inserts display with triple braces. The sidebar also inserts streamed text with insertAdjacentHTML/innerHTML and pending/result tool cards with innerHTML. Tool justifications and tool result content can be interpolated into those cards. The prior conditional DOMPurify call returned raw HTML when unavailable. The existing ValidationEngine sanitizer test does not exercise these sinks.
- Disposition: **Small fix** via scripts/utils/display-html.js at the final display boundaries. Use the existing global DOMPurify when present; if unavailable or it throws, encode the content as text. Applied to new/restored messages, direct chat output, streamed chunks, and pending/result tool cards. MarkdownRenderer remains a formatter; the display boundary owns sanitization. Avoided applying the escaped fallback twice in the normal sidebar callback path.
- Evidence: new tests/security/display-html-boundary.test.mjs checks raw markdown output against new/restored display handling, absent/throwing sanitizer fallback, and the actual sidebar methods passing output through sanitizer before message, streaming, and tool-card DOM sinks. The tests stub DOMPurify's sanitizer function; they do not establish the real DOMPurify behavior or Foundry's full rendering chain.
- Verification: security tier **19/19 passed**, integration tier **14/14 passed**, component tier **1/1 passed**, policy tier passed, and git whitespace check passed. Static tier remains unavailable in this checkout without installed ESLint dependencies. No live Foundry browser test was run.
- Remaining: verify DOMPurify availability and the actual browser DOM for final, restored, streaming, tool-card, and confirmation displays with hostile tags, event attributes, and script URLs. Confirm expected markdown, Foundry links, and legitimate tool display formatting survive. A missing sanitizer deliberately degrades rich HTML to escaped text. Do not mark H7 resolved until browser evidence and owner acceptance.
- Commit: the commit containing this entry and the mitigation is titled “fix: sanitize sidebar display boundaries (H7)”.
- Status: **Mitigated; awaiting live Foundry validation and owner acceptance**. No other finding was closed.
