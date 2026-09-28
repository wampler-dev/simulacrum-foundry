# Stabilization development plan

Status: **Paused by owner on 2026-09-27 with open runtime gates. C1, C2, H1, H2, H3, H4, H5, H6, M1, M2, M3, M4, M5, M6, M7, M8, M9, M11, and L1–L5 were owner-accepted for implemented code or disposition. H7 live rendering validation, the remaining M10 runtime assessment, the pack read permission candidate, and final runtime acceptance remain open. JS enhancements 1–4 are owner-accepted; JS enhancement 5 is implemented and awaits owner acceptance. Full runtime acceptance remains unverified; initial live checks and the H7 rendering repair are recorded below.**
Owner: wampler-dev
Adopted: 2026-09-27
Branch: `restart/from-upstream-main`
Reviewed code baseline: `91922c835dc6d269a35c2475a8f4de4a385aa616`
Reviewed restart commit: `8a58fa9d2f913a2e99aded48106571a8bb7050dc` (baseline plus historical checkpoint note).

## Binding scope and authorization

The owner paused the remaining live validation and runtime investigation on 2026-09-27 and opened the door to separately authorized JavaScript enhancements. Preserve the unresolved gates and their evidence requirements. Do not describe this pause as closure or claim full Foundry v14/D&D5e/Ollama acceptance from local tests. **Only the owner's explicit permission allows a concrete new task.** Completion of this plan does not automatically authorize subsequent work.

Recording this plan authorizes documentation only. It does not authorize implementation, code changes, dependency changes, feature restoration, or remediation commits. Obtain explicit owner authorization for a concrete task before starting implementation. Authorization for one task does not authorize the rest of the backlog. Read-only inspection and verification necessary to complete an already authorized task remain within that task.

Newly discovered issues may be recorded as blocked candidates; do not silently expand scope or begin work on them. If they block an authorized task, explain the dependency and seek explicit authorization. Do not use refactoring, cleanup, performance work, or test expansion as a route around this rule.

A finding is resolved by a verified fix, removal, consolidation, or an owner-accepted decision to leave it alone supported by evidence. An investigation is not resolved merely because it has been assigned, deferred, or covered by a passing unit test.

### Owner-directed pause — 2026-09-27

The owner said, “We will wait until later then,” regarding the blocked live checks, followed by “I am open to JS enhancements. Can we table the other plan safely for now?” The open checks are tabled until the owner resumes them or provides a reachable test environment. This is a priority change, not a waiver of H7, M10, the pack read permission investigation, or final acceptance. For any separately authorized enhancement, record the specific scope and tests without relabeling an unresolved runtime gate as passed. Reassess affected acceptance scenarios before claiming readiness for use or release.

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

The separate provider classes are not the principal chat transport. The dormant ChatInterface and alternate ChatHandler execution route were removed under L1; the supported path is the sidebar adapter through ConversationEngine. Conversation state and output buffers persist in user flags; diagnostics maintain additional data. Asset indexing is a separate persistent service. Automatic macro discovery remains disabled under C1.

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

H7 live validation is pending by owner direction. Its dependent browser, UI presentation, and final acceptance checks wait until the restart branch can be run in an authorized Foundry v14 environment. Independent remediation items may be considered in the stated order when the owner explicitly authorizes each task. Pending does not mean resolved or accepted.

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

### H7 live-validation attempt — 2026-09-27

- Authorization: the owner said “Approved. Please continue.” after the current plan identified H7 live browser validation as the immediate next step. This authorized the validation task, not another remediation item.
- The repository's isolated Playwright workflow requires a licensed Foundry zip in vendor/foundry, tests/e2e/.env.test, and installed Playwright dependencies. All three are absent from this workspace. No isolated Foundry v14 instance could be started here.
- A cloud-browser attempt to open the previously used address https://foundry.wampler.app was **rejected by automatic browser approval**, not by the owner. The stated reason was that this specific external origin had not been established as the authorized Foundry test environment and might expose private session content. The browser did not open the site. Do not route around that rejection or claim a live check occurred.
- No live validation results, new browser findings, or application code changes resulted from this attempt. H7 remains mitigated but **open**, and its previously recorded Node tests remain the only runtime evidence.
- To finish this task, the owner must identify the exact authorized Foundry test URL/environment with the restart branch installed, or provide the licensed isolated test prerequisites through an approved route. Then verify real DOM behavior for final, restored, streaming, pending/result tool-card, and confirmation content, including hostile tags/event attributes/script URLs, plus legitimate markdown and Foundry links. Do not use a production world for destructive probes.
- Status: **Blocked on an authorized live environment and browser access; awaiting owner acceptance after real validation**. The owner has not approved H7 closure or another task.

### H7 authorized-site retry — 2026-09-27

- The owner explicitly authorized access to Foundry.Wampler.app, resolving the prior uncertainty about the intended origin. A cloud-browser tab opened https://foundry.wampler.app/ without the earlier automatic approval rejection.
- Browser observation: title “Site Unavailable” and text “Unable to access this site.” One reload returned the same page. This is not evidence of a Foundry response, a sign-in wall, or a security exploit. No Foundry UI, module version, DOMPurify availability, or message-rendering behavior could be inspected.
- The owner subsequently confirmed that this branch is **not installed** on the site. Therefore the site cannot validate the H7 change even if cloud-browser access becomes available.
- The isolated local Playwright prerequisites remain absent as recorded above. No code or runtime behavior changed during this retry.
- Status: **H7 still open; live validation blocked by absence of the branch on the site and lack of access from this cloud browser**. Install the branch in an authorized isolated Foundry v14 test environment or provide the isolated test prerequisites before repeating the check. No other remediation task was authorized by site-access approval.

### H7 site-access clarification — 2026-09-27

- The owner supplied a phone screenshot showing the Foundry join page at foundry.wampler.app, including a “Server connection re-established” notice. The site is reachable from the owner's phone; the cloud-browser “Site Unavailable” result does **not** establish a general outage.
- The owner supplied the exact https://foundry.wampler.app/join URL. The cloud browser navigated directly to that route and still displayed “Site Unavailable” / “Unable to access this site.” This is specific to that browser/environment. No Foundry UI was inspected through it.
- The owner separately confirmed the restart branch is not installed there. A successful join-page visit would still not validate the H7 implementation. H7 remains open; no further route probing, login, production-world injection, or installation was performed.

### H7 deferral decision — 2026-09-27

- The owner directed: “I'm willing to come back to this one. Mark it as pending. Any other development that requires it as a prerequisite can also wait for now.”
- H7 is **pending**, open, and unaccepted. Do not repeat live access attempts, install the branch, or claim the mitigation is validated until the owner reopens that task and an authorized environment is available.
- Any work whose correctness requires H7 browser or UI evidence, including final UI presentation acceptance and release readiness, remains pending with it. Independent plan findings are not blocked merely by H7's pending status; each new task still requires the owner's explicit permission under AGENTS.md.
- This decision changes scheduling only. The H7 code and test evidence are unchanged.

### H2 implementation — 2026-09-27

- Authorization: after the H7 deferral, the owner stated “Excellent. I accept this current state and am willing to continue.” The next independent task was identified as H2 and explicitly scoped in the progress update. The authorization was applied to H2 only.
- Disposition: **Small fix, reuse existing code**. Replaced nonexistent createErrorResponse calls in document-copy.js and document-move.js with BaseTool.handleError. A missing source returns NotFoundError. Copy-phase failures preserve the original error message and type. World-folder update errors and a missing copy tool return normal error envelopes.
- Partial move: when the copy tool reports success and a later move phase throws, the response states that the move failed, instructs checking source and destination before retrying, and includes structured partial data: copyCompleted, destination, sourceState: unknown, and the returned copy content. It deliberately does not claim the source remains or assign a fabricated destination identity. M9 still owns non-atomic move semantics and actual returned IDs.
- Evidence: five behavioral tests in tests/regression/copy-move-errors.test.mjs exercised missing source, failed creation, copy-phase error, deletion failure after copy, missing copy tool, and world-folder update failure. The original code failed all five scenarios, typically with a secondary TypeError. All five pass after the change.
- Verification: regression tier **33/33 passed** plus the standalone compaction budget script; integration **14/14**, security **19/19**, policy passed; git whitespace check passed. Static tier still requires uninstalled ESLint dependencies in this checkout. No live Foundry v14/D&D5e document mutation was performed.
- Limits: a tool can report a failure after an uncertain side effect; this response reports the known phase and unknown source state. H1 approval remains in the dispatcher. M9 copy/move target identity and transaction behavior remain open. H7 remains pending independently.
- Commit: the commit containing this entry and H2 code is titled “fix: preserve copy and move failure details (H2)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, please continue.” The permission to continue was scoped to H3. H7 remains pending.

### H3 implementation — 2026-09-27

- Authorization: the owner accepted H2 and directed “please continue.” This authorizes H3 only.
- Disposition: **Small fix**. The update tool now passes the selected pack to DocumentAPI.applyEmbeddedOperations. The API selects pack.getDocument(id), validates document type and unlocked state, and uses the existing embedded permission check and Foundry mutation methods. A missing or mismatched pack fails before any world-document lookup or mutation. World operations still use the world collection.
- Evidence: tests/regression/embedded-pack-target.test.mjs exercises tool-to-API pack handoff, same raw ID in world and pack, ordinary world behavior, missing pack, and mismatched document type. All three behavioral tests pass. Regression 36/36 plus compaction budget, integration 14/14, security 19/19, and policy passed.
- Limits: mock documents prove routing and pre-mutation rejection, not actual Foundry v14 compendium writes or host permission behavior. H4 read-registry source identity remains open, including same-ID cross-source read prerequisites; H7 browser validation remains pending. Live mutation acceptance is still needed when a suitable installation is available.
- Commit: the commit containing this entry and H3 code is titled “fix: retain pack target for embedded updates (H3)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted. Please continue.” The permission to continue was scoped to H4. H7 remains pending.

### H4 implementation — 2026-09-27

- Authorization: the owner accepted H3 and directed “Please continue.” This authorizes H4 only.
- Disposition: **Small fix of existing registry contract**. The read registry now keys documents by world or pack source, pack ID, document type, and raw document ID. Read and create verification register the selected source; update and delete check the same source; successful update re-registers it, and successful delete unregisters only that source. The existing stale hash check remains.
- Evidence: tests/regression/read-source-identity.test.mjs exercises world and two packs with identical raw ID and data, cross-source denial for update and delete, stale detection per source, and source-specific deletion. The prior H3 test was updated to register the pack read explicitly. Regression 38/38 plus compaction budget, integration 14/14, security 19/19, and policy passed; git whitespace check passed.
- Limits: local mocks validate routing and prerequisites, not live Foundry v14 permission or pack mutation. M2 remains responsible for whether a paginated read gives sufficient evidence to count as a read; H7 live browser validation remains pending.
- Commit: the commit containing this entry and H4 code is titled “fix: scope read prerequisites to document source (H4)”.
- Status: **Owner accepted** on 2026-09-27: “I accept. As you continue...” The permission to continue was scoped to M3. H7 remains pending.

### M3 implementation — 2026-09-27

- Authorization: the owner accepted H4 and directed continuation, and requested tracking (documentation only) of appropriate JavaScript preprocessing opportunities. This authorizes M3 implementation and the opportunity register below, not implementation of additional candidates.
- Disposition: **Small fix to existing handoff**. Search results now include explicit read_document arguments containing the raw ID, document type, and pack when applicable. Read accepts those arguments or a linked/bare top-level world or compendium UUID, derives the pack and raw ID, and rejects mismatched source/type or embedded UUIDs before fetching. Bare raw IDs with explicit pack continue to work. No reference index or new routing layer was added.
- Evidence: tests/regression/search-read-identity.test.mjs passes world and pack search arguments directly to read with identical IDs, checks bare/linked compendium UUIDs, and confirms mismatch/embedded rejection before DocumentAPI.getDocument. Regression 40/40 plus compaction budget, integration 14/14, security 19/19, and policy passed.
- Limits: UUID parsing supports top-level world references and the standard two-component pack ID forms observed in search results; embedded references require a separate explicit contract. Search semantics and result limits remain M1; read context sizing remains M2. The mock tests do not establish live Foundry v14 UUID coverage or permission behavior.
- Commit: the commit containing this entry and M3 code is titled “fix: hand search identities directly to read (M3)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, please continue.” The permission to continue was scoped to M4. H7 remains pending.

### M4 implementation — 2026-09-27

- Authorization: the owner accepted M3 and directed continuation. This authorizes M4 only; the JavaScript opportunity register remains tracking only.
- Disposition: **Remove** scripts/core/tool-verification.js and its executor call. The generic verifier expected a conversation manager but received a callback, searched top-level result IDs while document tools return nested documents, passed `id` where read_document requires `documentId`, and swallowed errors. Create and update already fetch their selected source through DocumentAPI.getDocument after mutation and include the fetched document in their result. Removing the redundant call avoids a false claim or an extra model-visible tool result.
- Evidence: tests/regression/no-generic-post-verification.test.mjs drives executor create/update result handling and checks that it emits one result per call without invoking a second read. Regression 41/41 plus compaction budget, integration 14/14, security 19/19, and policy passed; git whitespace check passed.
- Limits: existing create/update readback is a fetch after write; it does not prove field-by-field persistence or atomicity. Live Foundry v14 behavior and partial mutation outcomes remain unverified. M8 owns the result envelope; M9 owns copy/move partial state. Do not imply stronger verification than the returned document supports. H7 remains pending.
- Commit: the commit containing this entry and M4 code is titled “remove: redundant post-tool verification (M4)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue on.” The permission to continue was scoped to M8. H7 remains pending.

### M8 implementation — 2026-09-27

- Authorization: the owner accepted M4 and directed continuation. This authorizes M8 only.
- Disposition: **Consolidate** status interpretation in a small shared predicate. A returned error, explicit success:false/isError/denied, or partial marker is a failure; a successful result has none of those. The registry now counts returned failures and marks their execution unsuccessful. The executor uses that status for loop outcomes and diagnostics. Compacted history preserves success, error, and partial markers. UI card formatting uses the same status for the returned result, including JSON-wrapped callbacks/history. The content/display payload shapes remain as the tools currently emit them.
- Evidence: tests/regression/tool-result-status.test.mjs exercises returned errors, explicit failure, partial outcomes, thrown errors, success, registry metrics, executor status, history compaction, callback, and failure cards. Regression 43/43 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: this aligns classification without converting every tool to a new envelope or claiming partial operations are atomic. Large partial details may remain in persisted output; M7 owns retention bounds. M9 owns copy/move actual identities and side effects; M6 owns retry/termination decisions. H7 browser validation remains pending.
- Commit: the commit containing this entry and M8 code is titled “fix: align tool result status across boundaries (M8)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue.” The permission to continue was scoped to M9. H7 remains pending.

### M9 implementation — 2026-09-27

- Authorization: the owner accepted M8 and directed continuation. This authorizes M9 only.
- Disposition: **Remove unsupported paths and use actual returned identity**. Copy rejects embedded destinations before reading or writing because applyEmbeddedOperations returns no created identity. Move rejects embedded sources and destinations before side effects. Supported world/pack copies return the ID supplied by the created document and structured destination metadata; JSON.stringify builds the model-facing result. A missing ID after creation produces an uncertain-destination failure, and a create exception after the create phase begins reports unknown destination state. Move refuses source deletion unless the copy returned a matching structured document ID, type, and target location. A failed deletion reports the actual copied ID and unknown source state; a locked source pack is rejected before copying.
- Evidence: tests/regression/copy-move-identity.test.mjs checks actual ID (including quoted names), rejection before side effects, absence of a prose-only identity, missing ID, and locked source pack. The earlier H2 tests now check structured partial identity and uncertain create-phase failures. Regression 48/48 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: cross-location move is still copy then delete and cannot be atomic through this tool. A reported failure can leave a copy and an uncertain source; the response instructs the user to inspect both before retrying. No automatic retry or rollback was added. Browser/Foundry v14 real document creation and deletion remain unverified, and H7 remains pending.
- Commit: the commit containing this entry and M9 code is titled “fix: use real copy identity and constrain moves (M9)”.
- Status: **Owner accepted** on 2026-09-27: “Please continue.” This was treated as acceptance of M9 and permission to work on H5. H7 remains pending.

### H5 implementation — 2026-09-27

- Authorization: the owner directed “Please continue” after reviewing M9. The next independent task was scoped as H5 in the progress update. This authorizes H5 only.
- Disposition: **Small fix**. SimulacrumCore.generateResponse detects whether the supplied messages are the conversation manager’s current array before compaction. After compaction, the initial provider request rereads getMessages() if it came from that managed array; independently supplied message arrays retain their existing behavior. The rolling summary still enters through getSystemPrompt.
- Evidence: tests/regression/initial-compaction-outbound.test.mjs forces actual ConversationManager compaction, inspects the first outbound native-tool request, verifies removed messages are absent, the latest question remains, and the new summary appears once. It also checks explicitly supplied messages are not overwritten. Regression 50/50 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: the local fake provider proves the request boundary; no live Ollama qwen3:14b context-size behavior or Foundry browser run occurred. M7 owns retention and large-output budgets. H7 remains pending.
- Commit: the commit containing this entry and H5 code is titled “fix: send compacted history on initial request (H5)”.
- Status: **Owner accepted** on 2026-09-27: “Excellent. What’s our overall progress so far? After reporting that, I accept and am willing to continue.” The progress report identified M1 as next; authorization was scoped to M1. H7 remains pending.

### M1 implementation — 2026-09-27

- Authorization: the owner accepted H5 and authorized continuation after a progress report. The progress report identified M1 as the next task. This authorizes M1 only.
- Disposition: **Fix existing search contract**. Search names by default. Explicit fields use available indexed fields for compendium packs; no full compendium document text is claimed. An empty query rejects with a list_documents hint. maxResults is an integer from 1 to 100, defaults to 50, and caps the combined output across world and packs. A pack-restricted query respects documentTypes; the tool says “showing up to” at the limit and directs narrower queries rather than claiming a complete total. Existing source-qualified handoff remains.
- Evidence: tests/regression/document-search-contract.test.mjs exercises world and two packs with duplicate IDs, explicit fields, pack/type selection, empty and unmatched queries, broad searches, and a limit that stops before indexing later packs. Regression 54/54 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: pack index availability and search permissions are modeled locally, not proven against an installed Foundry v14/D&D5e pack. The bounded result set does not provide pagination or an exact total; use a narrower query. Large document reads remain M2; stored large outputs remain M7. H7 live browser validation remains pending.
- Commit: the commit containing this entry and M1 code is titled “fix: align and bound document search (M1)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, please continue.” The permission to continue was scoped to M2. H7 remains pending.

### M2 implementation — 2026-09-27

- Authorization: the owner accepted M1 and directed continuation. This authorizes M2 only.
- Disposition: **Simplify/Fix** existing read behavior. read_document defaults to excluding embedded collections, supports explicit dot-path fields with missing paths listed, and forwards includeEmbedded to DocumentAPI. DocumentAPI uses the document class metadata.embedded mapping to remove top-level embedded collections when requested; its omitted-option default remains full data for existing callers. A single host document read supplies both the selected model view and a full same-version snapshot for the source-qualified stale-check registry. Responses over 12000 characters fail with a field/line-range hint before registering the read. Invalid line ranges fail instead of returning success containing an error string.
- Evidence: tests/regression/document-read-contract.test.mjs exercises world and pack shaped documents, omitted/full API option, exact AC/HP field paths, missing fields, embedded inclusion/exclusion, full-snapshot registry compatibility, and oversized output. The M3 search-to-read tests still pass. Regression 57/57 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: output is bounded but the host document is still loaded fully before projection, and JSON line pagination remains coarse. A single selected field exceeding the limit must be narrowed through another mechanism; M7 owns broader output storage/paging. Live Foundry v14 metadata and D&D5e paths are unverified; H7 browser validation remains pending.
- Commit: the commit containing this entry and M2 code is titled “fix: select and bound document reads (M2)”.
- Status: **Owner accepted for now** on 2026-09-27: “Accept it for now. Continue.” The implementation was accepted with live Foundry v14/D&D5e behavior and the separately tracked pack-read permission candidate still open. Continuation was scoped to M7.

### M7 implementation — 2026-09-27

- Authorization: the owner accepted M2 for now and directed continuation. This authorizes M7 only.
- Disposition: **Bound existing output buffer and display path**. Large tool content is retained for up to four recent calls, at most 64000 original characters per call plus an explicit truncation marker. The same bounds apply before saving user flags and when loading older saved buffers. New large results send a compact status/preview/access reference to both model history and UI callback rather than delivering the full payload to the sidebar. The compact result records whether storage was truncated; large error/partial/display metadata is bounded. read_tool_output can retrieve retained line ranges or a 10000-character range for long single-line output. No new external storage or indexing service was added.
- Evidence: tests/regression/bounded-tool-output.test.mjs drives a 200000-character result through executor, conversation save/load, and read_tool_output; checks compact history/UI payloads, retained-size/truncation marker, character paging, eviction, and bounding of legacy saved entries. The M8 result-status tests still pass. Regression 59/59 plus compaction budget, integration 14/14, security 19/19, component 1/1, and policy passed; git whitespace check passed.
- Limits: truncation loses the tail of a single over-limit result; the compact reference explicitly says to refine the original request. Legacy activeMessages and interaction diagnostic logs may still contain large older payloads; L5 owns diagnostics and H5 owns outgoing history compaction. No live browser persistence/reload measurement or actual Foundry flag-size validation occurred. H7 remains pending.
- Commit: the commit containing this entry and M7 code is titled “fix: bound retained and displayed tool output (M7)”.
- Status: **Owner accepted** on 2026-09-27: “Please continue. Accepted!” Continuation was scoped to H6.

### H6 implementation — 2026-09-27

- Authorization: the owner accepted M7 and directed continuation. This authorizes H6 only.
- Disposition: **Small turn-scoped capability filter plus dispatcher check**. The engine computes the tool set once from the current user request, advertises only that set on initial calls and retries, and passes the same set to the autonomous loop. The executor denies calls outside the set, including unadvertised native and legacy inline calls. Ordinary requests receive search/list/read/output paging and loop termination. Explicit creation, modification, deletion, copy/move, ownership, and code requests add only their matching tool; schema, asset, and folder discovery are offered when relevant. Existing destructive permission checks remain in force.
- Evidence: tests/security/turn-capabilities.test.mjs exercises offered schema filtering, read-only and explicit actions, native/inline dispatch denial, and retained schemas after a simulated history replacement and initial retry. Security 23/23, regression 59/59, integration 14/14, component 1/1, and policy passed; whitespace check passed.
- Limits: short English request matching can underselect on unusual wording or compound tasks and may overselect on ambiguous instructions; a denial should lead to a clarified new request. The loop and provider were not run against live Ollama or Foundry. Alternate ChatHandler paths outside ConversationEngine and direct registry callers are not constrained by this turn filter; L1 owns dormant orchestration paths. H7 remains pending.
- Commit: the commit containing this entry and H6 code is titled “fix: constrain turn tool capabilities (H6)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted. Please continue.” Continuation was scoped to M5.

### M5 implementation — 2026-09-27

- Authorization: the owner accepted H6 and directed continuation. This authorizes M5 only.
- Disposition: **Consolidate completion on a substantive assistant response**. After tool use, a plain text assistant answer now ends the turn immediately, is emitted once to the UI and saved once in conversation history. The same rule already applies to an initial no-tool answer. An empty response is still corrected with a bounded retry; `end_loop` remains available for explicit termination without text. The repeated text circuit breaker and instruction demanding `end_loop` after an answer were removed. The existing task tracker is closed on either exit path.
- Evidence: integration tests drive a tool call through a text-only continuation and assert one provider continuation, one visible answer, one persisted answer, no corrective churn, and `assistant_response` terminal logging; a separate test covers empty continuation correction. A direct no-tool engine answer is tested. Regression 59/59, integration 16/16, security 24/24, component 1/1, policy and whitespace checks passed.
- Limits: this accepts text as a final answer, even when the model merely describes an action it never called; R6 and M6 still own truthful recovery for narrated-but-unexecuted actions and failures. A live Ollama/Foundry UI session and persistence reload remain unverified. H7 remains pending.
- Commit: the commit containing this entry and M5 code is titled “fix: complete tool turns on assistant answers (M5)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, please continue.” Continuation was scoped to M6.

### M6 implementation — 2026-09-27

- Authorization: the owner accepted M5 and directed continuation. This authorizes M6 only.
- Disposition: **Remove tool-free model fallback after failed tool/provider calls**. Initial tool-call parsing failures remain limited to three engine attempts; exhaustion produces a deterministic terminal failure rather than another model completion. The AI client owns transport retries, so the loop makes one continuation call and reports a deterministic provider failure after those retries. Cancellation and request timeouts remain terminal. Tool denial/failure is recorded; a subsequent successful tool action may recover. If the latest action failed, or an explicit mutation/code request has no successful matching tool call, the model's claimed completion is replaced before UI display/history with a truthful terminal status. `end_loop` cannot convert such an unresolved failure into success. No new planning/router framework was added.
- Evidence: tests/integration/local/tool-loop-continuation.test.mjs covers provider exhaustion, cancellation, denied tool followed by claimed success, read-only tool followed by claimed mutation, recovery through successful retry, and bounded iteration. tests/security/turn-capabilities.test.mjs covers action without a tool call and initial tool-call failure exhaustion without fallback. Regression 59/59, integration 19/19, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: the turn capability classifier from H6 defines which requests count as explicit actions; uncommon wording can be under- or overselected. Successful tool result does not prove that all requested multi-step work was completed, and partial side effects still require inspecting tool results. Provider retry policy inside AIClient still allows up to six transport attempts; operational loop limits are L4. No live Foundry/Ollama execution or browser UI/reload check occurred. H7 remains pending.
- Commit: the commit containing this entry and M6 code is titled “fix: make tool failure and completion truthful (M6)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, please continue.” Continuation was scoped to M11.

### M11 implementation — 2026-09-27

- Authorization: the owner accepted M6 and directed continuation. This authorizes M11 only.
- Disposition: **Remove obsolete prompt sections and scope legacy schemas**. The active prompt now contains a short stable identity/work rule and the user's optional custom instructions. Native mode uses provider-supplied selected schemas without duplicating them in the prompt. Legacy mode embeds only the selected, nonblacklisted schemas with the inline JSON call format. The prompt no longer enumerates macros, every document subtype, `manage_task`, nonexistent `document_*` names, or the superseded rule requiring `end_loop` after every answer. The effective schema set is kept through compaction and loop continuations; the executor remains authoritative.
- Evidence: tests/regression/scoped-system-prompt.test.mjs inspects actual native and legacy outbound requests, including forced compaction, and verifies the legacy prompt has only the selected schema while native prompt has no schema dump. The native builder test would fail if it enumerated macros. Regression 62/62, integration 19/19, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: the user-defined custom prompt can still mention unavailable tools, and legacy inline parsing remains dependent on model compliance; the dispatcher enforces the turn scope. Old localization strings remain in en.json but are no longer referenced by the active builder; removing those unused keys would offer little runtime benefit. No live Ollama/Foundry prompt or context measurement occurred. H7 remains pending.
- Commit: the commit containing this entry and M11 code is titled “fix: scope system prompt to active capabilities (M11)”.
- Status: **Owner accepted** on 2026-09-27: “Accept, go forward please.” Continuation was scoped to L4.

### L4 implementation — 2026-09-27

- Authorization: the owner accepted M11 and directed continuation. This authorizes L4 only.
- Disposition: **Bound the existing loop**. The default is 12 total assistant loop steps per turn, with an effective maximum of 20. A saved 0, negative, fractional, or missing setting uses the finite default; an older value above 20 is capped at 20. The world setting describes these rules. Every assistant loop iteration now consumes a step, including successful tool calls. The last allowed step can complete, but cannot initiate another provider continuation. Exhaustion returns the existing visible terminal status and persists it in conversation history without inventing an unmatched tool-result message. Cancellation remains immediate.
- Evidence: integration tests cover successful tool calls exhausting a two-step budget, failed calls, a saved zero setting exhausting after the finite default, invalid/oversized setting normalization, and cancellation. Regression 62/62, integration 22/22, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: 12/20 is a conservative operational budget pending owner acceptance and live workload measurements. Each provider request retains its separately configured timeout and retry budget; this is a step count, not a wall-clock deadline. Previously saved settings above 20 may still display their old configured number in Foundry's settings UI, while runtime caps them; the hint explains the cap. H7 live validation remains pending.
- Commit: the commit containing this entry and L4 code is titled “fix: bound autonomous tool steps (L4)”.
- Status: **Owner accepted**, including the 12-step default and 20-step ceiling, on 2026-09-27: “Accepted. Please continue.” Continuation was scoped to M10.

### M10 recovery fix and investigation — 2026-09-27

- Authorization: the owner accepted L4 and directed continuation. This authorizes M10 investigation and a narrowly evidenced recovery fix only.
- Disposition: **Small fix to interrupted-rebuild cache recognition; leave the larger indexing design open**. A rebuild previously set `hasEverIndexed` before traversal, then cleared the completion timestamp and streamed partial records. Reload treated the flag alone as a complete cache. Cache reuse now requires a valid completion timestamp; rebuild clears the flag and timestamp before streaming and writes both only after traversal finishes. An interrupted rebuild will be retried after reload.
- Evidence: tests/regression/asset-index-recovery.test.mjs simulates old interrupted metadata, invalidation before writes, completion metadata, and restoring completed counts. Regression 65/65, integration 22/22, security 26/26, component 1/1, and policy passed; git whitespace check passed. This is a local IndexedDB test double, not a measured Foundry/browser run.
- Remaining M10 assessment: the service scans six roots at startup and every five minutes, makes full IndexedDB cursor passes for substring search, and globally wraps FilePicker upload/createDirectory. Successful repeated uploads increment counters even when replacing an existing path; source identity is inferred from path prefixes, so equal path strings across data/public sources may collide. Recursive browse errors are silently skipped and a rebuild can be marked complete despite missing subtrees. Assess actual relevance and latency before changing these mechanisms. Needed live evidence: representative ~15931-file index duration and search latency, normal and repeated upload behavior, interrupted rebuild/reload, stale/external changes, and source-separated paths in the supported Foundry environment. Do not claim a full M10 closure from the metadata test alone.
- Commit: the commit containing this entry and M10 recovery code is titled “fix: reject interrupted asset index cache (M10)”.
- Status: **Narrow fix owner accepted** on 2026-09-27: “Accepted, continue please.” The remaining M10 runtime investigation is open pending live measurement; continuation was scoped to independent L1. H7 and work dependent on the live environment remain pending.

### L1 removal — 2026-09-27

- Authorization: the owner accepted the narrow M10 recovery fix and directed continuation. This authorizes L1 only.
- Disposition: **Remove dormant alternate orchestration and UI classes**. `ChatHandler.processUserMessage` is called from the sidebar and delegates to `ConversationEngine`; the older `handleAIResponse`/`handleToolExecution`/recursive retry branch had no repository caller and could bypass H6 turn capabilities. That branch was removed. `scripts/ui/chat-interface.js` and `scripts/ui/confirmation.js` had no imports, module initialization, or call sites; they were removed. Keep `SimulacrumCore.processMessage` as the compatibility entry point, the sidebar `ChatHandler` adapter, and the inline permission confirmation flow in tool-execution.js.
- Evidence: repository-wide caller and initialization searches found only self-references for the deleted methods/classes. tests/integration/local/active-chat-path.test.mjs drives the supported adapter with one user message and verifies one engine request, one persisted answer, and one UI callback. Regression 65/65, integration 23/23, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: repository search cannot establish whether an untracked third-party module imports these internal files directly. No live Foundry sidebar or extension compatibility check occurred; H7 live validation remains pending. The module's exposed `SimulacrumCore.processMessage` contract remains in place.
- Commit: the commit containing this entry and L1 removal is titled “refactor: remove dormant chat flows (L1)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue.” Continuation was scoped to L2.

### L2 implementation — 2026-09-27

- Authorization: the owner accepted L1 and directed continuation. This authorizes L2 only.
- Disposition: **Remove dead read preparation and fix public examples**. `DocumentReadTool.execute` uses `_formatDocumentContent` and `DocumentAPI.getDocument`; `prepareDocumentData` and recursive `processReferences` had no caller and were removed. `getExamples` now uses the required `documentId`, supported pack selection, and exact field paths; it no longer suggests reading by name or unsupported `withContent`.
- Evidence: tests/regression/document-read-contract.test.mjs validates and executes each example with a matching world/pack Actor fixture, confirming the selected field value. Repository searches found no callers for the removed helpers. Regression 66/66, integration 23/23, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: example IDs and pack names are placeholders that users must replace with actual search results. Live Foundry v14/D&D5e execution remains pending with the broader H7 environment validation. No other DocumentAPI or schema behavior was changed.
- Commit: the commit containing this entry and L2 code is titled “refactor: remove dead read helpers and fix examples (L2)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue.” Continuation was scoped to L3.

### L3 assessment — 2026-09-27

- Authorization: the owner accepted L2 and directed continuation. This authorizes L3 assessment only.
- Disposition: **Leave DocumentAPI reflection and mock-friendly fallbacks alone**. Schema lookup is actively used by `inspect_document_schema` and document creation; world/pack reads and mutations use the same DocumentAPI surface. Replacing the large generic reflection implementation without a reproduced runtime failure would add risk for little demonstrated value. No production code was changed for L3.
- Evidence: tests/regression/document-schema-reflection.test.mjs exercises a top-level Actor, a dnd5e-shaped NPC subtype field, and an embedded Activity class through `getDocumentSchema`. Existing read/search/create/update tests continue to exercise other DocumentAPI paths. Regression 67/67, integration 23/23, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: fixture behavior does not prove Foundry v14/D&D5e runtime metadata, permission behavior, or exhaustive schema coverage. The separately tracked compendium read permission candidate is still open; this leave-alone recommendation does not resolve it. H7 live validation remains pending.
- Commit: the commit containing this assessment and behavior fixture is titled “test: document schema reflection contract (L3)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue.” Continuation was scoped to L5. No other finding was closed.

### L5 bounded interaction diagnostics — 2026-09-27

- Authorization: the owner accepted the L3 leave-alone disposition and directed continuation. This authorizes L5 only.
- Disposition: **Simplify diagnostic persistence**. Ordinary logging remains enabled and retains timestamps, message lengths, tool identity, result success/duration, and correlated loop events. It no longer stores a second full copy of conversation text, tool arguments/results, or the custom system prompt. With `CONFIG.debug.simulacrum === true`, message, argument, and result previews are limited to 500 characters. Persisted logs are limited to 500 entries; loading older logs drops excess entries and bounds retained payloads. Loop event details preserve named fields for diagnostics with bounded keys and values. Saved flags and exports apply the current debug policy.
- Evidence: `tests/regression/interaction-log-bounds.test.mjs` checks normal persisted diagnostics without large duplicate payloads, debug previews, legacy flag loading, eviction, and redaction after debug is disabled. Existing tool-loop integration tests verify the loop reason contract. Regression 69/69, integration 23/23, security 26/26, component 1/1, and policy passed; git whitespace check passed.
- Limits: debug previews can contain user or tool data by explicit debug policy. Existing persisted flags are bounded on the next load and subsequent save; live Foundry persistence, UI export, and privacy behavior remain unmeasured until H7. This does not change conversation history or console logger output.
- Commit: the commit containing this entry and logging changes is titled “fix: bound interaction diagnostics (L5)”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue.” No independent remediation task remains in the ordered plan. H7 live validation, M10 runtime measurement, the pack read permission candidate, and final runtime acceptance remain pending; this acceptance does not close them or authorize a new task.

### H7 live validation retry — 2026-09-27

- Authorization: after the L5 acceptance, the owner directed “Accepted, continue.” This authorizes resuming the pending H7 live rendering validation; it does not authorize unrelated runtime investigations.
- Attempt: the authorized cloud browser opened `https://foundry.wampler.app/join` and `https://foundry.wampler.app/`. Both displayed “Site Unavailable — Unable to access this site.” No Foundry login, world, module version, sidebar, or rendering surface was reachable from that browser.
- Status: **Blocked; H7 remains open**. Obtain an accessible isolated Foundry v14 test world with the restart branch installed and test account access before testing malicious attributes/URLs in final, streaming, and tool output. This retry establishes no safety or exploitability result and does not establish whether the restart branch is installed at the host.

### JS enhancement 1 — exact named reference and source — 2026-09-27

- Authorization: the owner selected the first prioritized optimization and explicitly directed “Do it. I accept.” This authorizes only an exact named reference path over the existing search/read contract.
- Disposition: **Extend `search_documents`, not the tool framework**. `exact=true` matches the complete name and stops after two candidates. Zero is no match; one is a source-qualified identity for `read_document`; two means ambiguity and requires a source or user choice. `source` accepts `world`, a pack ID, or an exact readable pack title. Duplicate titles and unknown/inaccessible sources fail explicitly. Existing broad search and pack selection remain available. Search index matches are not presented as document facts, and the tool instructs the model to read the selected document for facts.
- Evidence: regression tests cover world/pack duplicate names, exact title selection, title collision, inaccessible and unknown sources, no match, source mismatch, and source-qualified search-to-selected-field-read handoff. Regression 72/72, integration 23/23, security 26/26, component 1/1, and policy passed; syntax and whitespace checks passed.
- Limits: the model must still supply the name and source as tool arguments; this does not parse arbitrary natural-language source phrases or automatically read the document. Two candidates establish ambiguity but do not enumerate every duplicate. The static tier cannot run in this checkout without installed ESLint dependencies. Real Foundry v14/D&D5e metadata, pack permission behavior, and qwen3:14b tool use remain unverified under the paused runtime gates.
- Commit: the commit containing this entry and search change is titled “feat: exact source-qualified document search”.
- Status: **Owner accepted** on 2026-09-27: “I accept. Continue.” Continuation was scoped to JS enhancement 2. No paused runtime gate was closed.

### JS enhancement 2 — smaller turn capability surface — 2026-09-27

- Authorization: the owner accepted JS enhancement 1 and directed continuation. This authorizes only the next prioritized selector optimization.
- Disposition: **Adjust the existing selector and transport**. Obvious standalone greetings and thanks offer no tools. Named document reads retain search, read, output paging, and loop completion but do not offer browsing. Listing/inventory requests offer `list_documents`. A request for artwork the document already uses does not offer asset search, while a request for alternative artwork does. The turn's allowed set remains fixed and enforced by the dispatcher. The AI client omits `tools` and `tool_choice` from a truly empty native-tool request.
- Evidence: security tests exercise direct, named, browsing, existing-artwork, alternative-artwork, read-only, and action requests; a regression test inspects the outbound no-tool provider body. Existing continuation and dispatcher tests cover the fixed allowed set. Regression 73/73, integration 23/23, security 27/27, component 1/1, and policy passed; syntax and whitespace checks passed.
- Limits: these intentionally small text rules are not a general natural-language intent parser. The asset search tool remains available on many artwork requests because this static selector cannot know whether the selected document has an image before reading it. No real qwen3:14b tool-choice, latency, or Foundry acceptance measurement occurred; the paused gates remain open. The static tier needs absent local ESLint dependencies.
- Commit: the commit containing this entry and selector change is titled “fix: trim routine turn tool exposure”.
- Status: **Owner accepted** on 2026-09-27: “Accept, continue.” Continuation was scoped to JS enhancement 3. No paused runtime gate was closed.

### JS enhancement 3 — structured search handoff — 2026-09-27

- Authorization: the owner accepted JS enhancement 2 and directed continuation. This authorizes only the next prioritized search-output optimization.
- Disposition: **Consolidate model-facing search output**. Existing broad and exact search results now share one compact JSON envelope with `status`, conservative `limitReached`, guidance, and candidate records. Each candidate has a source (`world` or pack ID), optional readable pack title and Foundry-provided UUID, and exact `read_document` arguments. An incomplete hit fails explicitly instead of fabricating an ID or UUID. Exact results retain unique/ambiguous/no-match semantics and never promote an index match into document facts. The user-facing short summary stays separate.
- Evidence: regression tests inspect bounded broad results, duplicate-source ambiguity, pack-title selection, no match, malformed identity failure, and JSON candidate arguments consumed by a selected-field read. Regression 74/74, integration 23/23, security 27/27, component 1/1, and policy passed; syntax and whitespace checks passed. The static tier remains unavailable without local ESLint dependencies.
- Limits: the broad result limit is a cap, not a count of all matches; reaching it cannot prove additional matches exist. Search order remains Foundry world/type/pack traversal order, and the model still chooses a candidate for broad ambiguous results. No token reduction, qwen3:14b tool behavior, or live Foundry v14 behavior was measured. H7, M10, pack permission, and final acceptance gates remain paused.
- Commit: the commit containing this entry and result contract is titled “refactor: structure document search handoff”.
- Status: **Owner accepted** on 2026-09-27: “Please continue, I accept.” Continuation was scoped to JS enhancement 4. No paused runtime gate was closed.

### JS enhancement 4 — targeted existing artwork read — 2026-09-27

- Authorization: the owner accepted JS enhancement 3 and directed continuation. This authorizes only the next prioritized selected-artwork read optimization.
- Disposition: **Reuse `read_document` field selection**. Optional `view="artwork"` projects `name` and `img`, plus `prototypeToken.texture.src` for Actors, from the same authoritative source-qualified read. It is mutually exclusive with explicit `fields`; absent values appear in `missingFields`. No new tool, index, asset search, or Foundry mutation was added. The existing turn selector does not expose `search_assets` for clear requests about artwork the document already uses; alternative artwork requests retain it.
- Evidence: regression fixtures exercise world and pack Actors, large unrelated system data, missing images, non-Actor Item artwork, conflicting arguments, and exact source → artwork read with no asset-search capability. Regression 78/78, integration 23/23, security 27/27, component 1/1, and policy passed; syntax and whitespace checks passed.
- Limits: the model must request the artwork view; JavaScript selects the paths after that choice. This is an Actor-oriented projection over Foundry field data, not proof of every system's art conventions. A missing field does not trigger an autonomous alternative asset search. Real Foundry v14/D&D5e and qwen3:14b behavior remain unmeasured under the paused gates. The static tier needs absent ESLint dependencies.
- Commit: the commit containing this entry and selected-read change is titled “feat: targeted document artwork view”.
- Status: **Owner accepted** on 2026-09-27: “Accepted, continue please.” Continuation was scoped to JS enhancement 5. No paused runtime gate was closed.

### JS enhancement 5 — targeted create validation feedback — 2026-09-27

- Authorization: the owner accepted JS enhancement 4 and directed continuation. This authorizes only the next prioritized schema-discovery optimization.
- Disposition: **Reuse the existing schema validator and remove duplicate dumps**. Unknown top-level create fields now yield the rejected names, a bounded sample of valid top-level fields with `name`, `type`, and `system` first when present, and specific migration hints. The full embedded-schema response and a separate unused formatter were removed. The error envelope retains type and rejected fields without repeating the entire schema. Tool descriptions reserve schema listing and inspection for unknown type/subtype or uncertain field structure; explicit schema requests still work.
- Evidence: a behavioral regression fixture with 92 top-level fields confirms bounded feedback, no repeated schema object, and no creation side effect. Existing schema reflection tests retain inspection coverage. Regression 79/79, integration 23/23, security 27/27, component 1/1, and policy passed; syntax and whitespace checks passed.
- Limits: this handles unknown **top-level** fields, not every nested or system-specific Foundry validation failure. Broad schema inspection still returns a full schema when explicitly requested. The impact on qwen3:14b call frequency and real D&D5e validation is unmeasured; H7, M10, pack permission, and final acceptance remain paused. The static tier needs absent ESLint dependencies.
- Commit: the commit containing this entry and validation response change is titled “fix: target create schema correction”.
- Status: **Implemented; awaiting owner acceptance**. No other enhancement was authorized.

### Newly observed candidate — pack read permissions (investigate with separate authorization)

- DocumentAPI.getDocument uses pack.getDocument(id) and returns its object without the module-level permission check used for world reads and pack search. It is uncertain whether Foundry v14 getDocument enforces the user’s pack/document read permission at this boundary. This was observed during M2 but no policy change was authorized or made.
- Before accepting any security claim for pack reads, test a hidden/restricted pack and a non-GM user in an authorized Foundry environment; if the host does not enforce it, add the smallest permission check at the actual boundary. Track this as a blocked candidate until separately authorized. Do not infer exploitability from source inspection alone.

### Newly observed candidate — create tool examples (separate authorization)

- `DocumentCreateTool.getExamples()` includes an example with `name` outside `data`, while the tool schema requires `data` and creation expects `data.name`. Repository search did not reveal a caller for these examples, so the runtime impact is uncertain. This was observed during JS enhancement 5; its remediation was not authorized under that task. Check actual consumers before replacing or removing examples.

## Deterministic JavaScript opportunity register (tracking only)

The owner asked that potential server-side or Foundry-browser JavaScript preprocessing be recorded as work proceeds. These are candidates under existing findings, not separate authorization or design decisions. Prefer existing Foundry APIs and existing module code; require behavior and context measurements before adding custom layers.

| Existing finding | Mechanical work to evaluate | Model burden avoided | Boundary / evidence needed |
| --- | --- | --- | --- |
| M1, M2 | Bound search results and select only requested document fields in DocumentAPI/tool code. | Scanning irrelevant matches or long JSON to locate a few fields. | Honor permissions, source and schema; measure result sizes and pagination. |
| M3, H4 | Produce and consume source-qualified document identity in search/read/mutation code. | Parsing UUID display syntax and remembering pack identity. | M3 handoff implemented for top-level reads; mutation identity and embedded references remain explicit future checks. |
| M4, M8 | Reuse mutation readback and normalize result/error envelopes mechanically. | Inferring success from prose or nested output. | Verify actual Foundry result and partial side effects; do not claim verification after exceptions. |
| H6, M11 | Derive the offered tools from a dispatcher-enforced capability set per turn. | Selecting among unrelated administration, mutation, schema, or executable tools. | Continue the same allowed set through retries and loop turns. |
| M5, M6 | End and retry turns from explicit execution state. | Guessing whether described actions were executed or whether another tool round is needed. | Preserve truthful visible output and bounded recovery. |
| M7, H5 | Limit retained tool output and compact the actual outbound history. | Re-reading huge prior results and summaries. | Measure transport tokens, persisted flags, UI output, and continuation. |
| M9 | Use actual returned document IDs and explicit partial-state markers for copy/move. | Parsing prose to identify a new target or deciding if a move completed. | Avoid duplicate mutations on retry; preserve approved source and destination. |

### Live installation test and H7 rendering repair — 2026-09-27

- Authorization: after reviewing the owner's two screenshots, the owner explicitly approved the proposed rendering fix and documentation: “Yes you may. Please proceed.” Scope is the literal-HTML rendering failure. Source-selection and AC remediation are not authorized by this task.
- Environment/evidence: owner installed the restart package from commit `5a5c616`; console reports Foundry v14, D&D5e 6.0.5, qwen3:14b in the screenshot. Simulacrum initialization completed. A submitted “Hello” received a new assistant reply; no-tool transport and idle-state details were not independently captured.
- Failed reference scenario: exact search reported no match for the Goblin Warrior request, followed by broad “Goblin” search with two hits, an oversized read rejected with `READ_TOO_LARGE`, and a successful selected-field retry. The final answer reported 7 HP for “Goblin” and no AC. The screenshot shows Goblin Warrior entries under both Heroes of the Borderlands and Dungeons & Dragons Monster Manual. Requested identity/source were not established; this is a failed acceptance scenario. Actual tool arguments and returned candidates are needed to separate model argument error from search implementation failure. AC needs investigation against the correct Actor and requested paths, including serialized versus prepared data. No mutation calls appear in the supplied transcript; this is not a complete side-effect audit.
- Confirmed display defect: the second screenshot shows literal card and paragraph tags in the sidebar. `sanitizeDisplayHtml` depended on `globalThis.DOMPurify`, but the module supplied no such dependency; absent/failed sanitization intentionally escaped every tag. This fallback matches the observed output. The earlier boundary tests asserted escaping and mocked successful sanitization; they did not prove normal rendering without a host sanitizer. This defect was introduced by the restart branch's H7 hardening, not demonstrated as an upstream defect.
- Disposition: **Reuse an established sanitizer with an explicit dependency**. Bundle unmodified DOMPurify 3.4.16 (ES module, license, source map, provenance/integrity note) and import it at the existing common display boundary. Use its HTML profile. Preserve encoded-text fallback for a missing/failed sanitizer API and require a string result. Update both local and release packaging to include vendor files; no CDN, custom sanitizer, new tool, or template bypass.
- Verification: security 27/27, regression 79/79, package 1/1, and policy passed. New `npm run test:display-browser` test passed in headless Chromium 154.0.8037.57 using real DOMPurify and the actual sidebar methods with minimal Foundry globals. It checks visible card structure, formatting, streaming append paths, restored messages, pending/result cards, persisted card display, Foundry-style data-uuid links, idempotence, and removal of tested scripts/event handlers/javascript URLs. No attack callback executed. The default Playwright browser download failed; a verified ZIP from Google's Chrome-for-Testing distribution supplied the browser through the test's explicit executable override. Syntax and first-party whitespace checks passed. The file-size gate fails on the pre-existing DocumentAPI growth (1,680 lines versus its 1,636-line baseline), unchanged by this repair. The unmodified upstream MPL license contains one trailing space; it is retained verbatim.
- Limits: this browser fixture stubs Foundry enrichment and application infrastructure; it does not establish full Foundry v14 rendering safety or all enrichment/link behavior. H7 remains open pending owner retest and remaining live security validation. Existing escaped UI state may need a fresh conversation for clean validation; do not blindly unescape historical content. The static ESLint tier remains unavailable without checkout dependencies. Maintain the pinned sanitizer against upstream security releases.
- Other observed candidates (not fixed here): optional `scripts/build-info.js` returns 404 and startup falls back to build:dev; Simulacrum uses the deprecated global loadTemplates. Other modules/integrations emitted errors; their causes are outside this repair. Keep source-qualified search failure, field-read semantics, and packaging diagnostics open for separately authorized work.
- Status: **Implemented and locally verified; awaiting owner installation/retest and acceptance**. No live acceptance gate is closed by these local checks.

### Live source-selection diagnosis and small search/read repairs — 2026-09-27

- Authorization: the owner approved tracing actual search arguments, source identities and requested fields, with resulting small search/read fixes: “Yes, I authorize your proposed course of action.” This is the current focused task; it does not reopen other paused work.
- Rendering retest: after installing `52e931b`, the owner's screenshot shows formatted tool cards and text rather than literal HTML. The ordinary rendering regression is live-confirmed fixed. This is not a malicious-content test and does not close the broader H7 safety gate.
- Runtime evidence: all three search calls explicitly selected `dnd5e.monsters`, whose installed title is “Monsters (SRD)”. The requested source is installed as `dnd-monster-manual.actors`, titled “Actors”. Other official modules also have packs titled “Actors”. The read then selected the SRD Goblin and requested `system.armor.class.value` plus `system.attributes.hp.value`. The model presented the wrong source and added an unsupported AC suggestion. The requested Goblin Warrior was not read.
- Revised diagnosis: READ and OBSERVER both returned true for every Actor pack in the owner's GM session. The invalid READ permission vocabulary did **not** explain this run. Search was directed to the wrong pack by model arguments. Our JS enhancement 2 suppression removed `list_documents`, the existing installed-pack discovery mechanism, from this named-reference request. Tool schema examples supplied the SRD pack ID; example-induced selection is plausible, not proven. Existing pack discovery lacked owning module/system titles and used metadata.id rather than the collection identity.
- Disposition: **Consolidate/reuse existing discovery and small contract corrections**. Restore `list_documents` to the ordinary read capability set and remove its redundant keyword gating; social turns still expose no tools. Enrich existing pack listing with authoritative collection IDs and owning package IDs/titles, filtered by OBSERVER permission without loading indexes/documents. Remove the SRD pack example from search/read/list schemas; describe discovery as the prerequisite when the requested source's ID is unknown. Search outputs now expose the requested source even for zero matches. No new discovery tool, index, catalog cache, or natural-language source parser was added.
- Field correction support: selected reads retain missingFields and add at most five missing-path hints, each with at most twenty actual child paths under the nearest existing parent and an explicit truncation flag. No values or full schema are dumped for hints. Missing serialized data is explicitly distinguished from an absent statistic, and no AC formula/value is invented. This facilitates correction of the observed nonexistent path; it does not establish how the correct live Actor exposes prepared AC.
- Permission contract: change the three pack-search checks from READ to the documented OBSERVER ownership level and make search fixtures reject unsupported permission names. This corrects an independently verified API mismatch; it is not claimed as the GM-session failure's cause. The separately tracked direct pack-read permission gate remains open.
- Verification: regression 81/81, integration 23/23, security 27/27 and policy passed. A new behavioral fixture exercises same-title packs from different modules, SRD versus Monster Manual identity, hidden-pack exclusion, metadata-only discovery, exact source search, search-to-read handoff, capability availability, and bounded missing-field hints. Fixture HP/AC data are synthetic and do not validate official monster statistics or real Foundry prepared data. Syntax/whitespace checks passed. Existing static limitations (absent ESLint dependencies and DocumentAPI's pre-existing over-baseline size) remain; no baseline waiver was made.
- Status/limits: **Implemented; awaiting live retest and owner acceptance**. The model still selects tools and translates the requested book into an observed catalog entry; this patch does not mechanically guarantee faithful source selection or prevent all unsupported final prose. Source matching via `source` still means an exact pack title/ID, not a module/book title. Use the discovered pack ID where pack titles collide. Correct Monster Manual AC retrieval and end-to-end acceptance remain unproven. Reuse the original natural-language request for the next live test.

### Discovery compaction follow-up — 2026-09-27

- Scope: continuation of the owner's authorized source-selection investigation and small search/read fixes; this corrects the same failed acceptance path, not a new development goal.
- Live retest of `252930e`: the model called Compendium listing but again selected `dnd5e.monsters`, misidentified it as the Monster Manual, and resisted the owner's correction. It also incorrectly equated read-only processing of AC with mutation. Source selection and correct Actor AC remain failed/unproven.
- Decisive evidence: the owner retrieved the persisted tool message. The 82-pack catalog was 10,310 serialized characters; the dispatcher supplied `_compacted: true` with a 500-character preview of five lines containing the SRD packs, but no Monster Manual. The retained output contained `dnd-monster-manual.actors` with the correct module title. The model did not page through that output. Therefore the prior inference that the model had seen and ignored the correct source is not supported. Our previous catalog fixture bypassed the dispatcher's compaction boundary.
- Disposition: **Reuse the existing listing tool with bounded hierarchical discovery**. `list_documents(documentType="Compendium")` now groups readable packs by owning package and returns source IDs/titles/counts. Calling it with a returned `packageId` lists only that source's exact pack IDs and document types. Pages are ordered by identity, contain at most 20 entries, and fit a 3,500-character serialized-result budget (below the dispatcher's 4,000-character compaction threshold). `nextPage` gives ready-to-use arguments if more entries remain. An oversized single identity fails explicitly rather than truncating or inventing an ID. Discovery still uses metadata only. The redundant flat pack formatter is removed; no new tool, index, custom NLP router or global compaction exemption is introduced.
- Tests: the new integration fixture uses the real registry, list tool, dispatcher and ConversationManager persistence with 84 packs. It verifies the source title and selected Actor pack reach model-facing history without `_compacted` or a tool-output-buffer dependency. A 1,225-pack fixture verifies source and per-source paging coverage with no lost or duplicate entries; error cases cover invalid offsets/sources and oversized identity. Regression 81/81, integration 26/26 and policy passed; syntax and whitespace passed. These are synthetic runtime fixtures, not evidence of qwen compliance or live Foundry acceptance.
- Status: **Implemented; awaiting installation/retest**. Generic compaction remains intact for other tools. Discovery instructions and schemas describe the new source-to-pack sequence. The change adds a source selection round trip, but eliminates repeatedly transmitting all 82 packs and relying on the model to fetch hidden catalog lines. Qwen can still choose incorrectly; no semantic source guarantee is claimed. AC preparation and the remaining safety/runtime gates remain open.

### Prepared system-field read repair and source-selection retest — 2026-09-27

- Scope: continuation of the already authorized focused search/read remediation. No separate feature or rules engine is introduced.
- Live source-selection result on `dd74185`: the original natural-language request, without owner correction, listed 12 source packages, selected the Monster Manual's four packs, searched `dnd-monster-manual.actors`, and read exactly Goblin Warrior. Source selection and the search/read identity handoff passed this observed run. HP was reported as 10; AC remained missing. This single success does not establish reliability across other requests or repetitions.
- Decisive live read evidence: the owner's read-only console comparison of `Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior0` showed prepared `system.attributes.ac.value = 15` and `system.attributes.hp.value = 10`. The default `toObject()` snapshot omitted ac.value, retaining flat/calcs/formulas/override. Foundry had already performed the mechanical calculation; our read path discarded its result. The model's claims that reading/deriving AC required modifying the document were incorrect.
- Disposition: **Reuse Foundry's prepared values for explicitly selected system fields**. DocumentAPI provides an optional same-read prepared-system callback after the existing read access path; DocumentReadTool projects only requested `system.*` paths from it, falling back to stored values when a path is absent. Each returned field is labelled prepared or stored in fieldSources. Non-system fields and full-document reads retain stored-data behavior. No formulas are evaluated, no prepare/update/import method is called, and no full prepared Actor dump is introduced. Existing output bounds still apply to selected objects as well as scalars.
- Correctness safeguard: the same full stored snapshot remains the mutation prerequisite. Prepared data is never merged into that snapshot or used as writeback data. Missing prepared values remain missing; ac.flat is not silently substituted for ac.value. Own-property path traversal remains enforced. Prototype-only getters and system-specific data outside system.* are not newly exposed.
- Verification: regression 84/84, integration 26/26, security 27/27, policy, syntax and whitespace checks passed. Three added behavioral tests reproduce the observed stored/prepared split for world and pack Actors, verify a selected response below 1,200 characters despite large equipment data, catch accidental serialization of unrelated prepared fields, check prepared-versus-stored labels and fallback, preserve full-read behavior, verify prepared-only changes do not contaminate stale checks while stored changes still fail them, and prevent callback exposure following world permission denial. Fixture mutation/preparation methods throw if called. No live module retest has yet occurred for this patch.
- Status: **Implemented; awaiting owner installation/retest and acceptance**. Expected live outcome for the observed document is AC 15 and HP 10. This expectation comes from the owner's actual Foundry data, not model knowledge or a reconstructed D&D formula. The direct compendium read permission investigation, broader H7 security checks, M10 and final acceptance remain open. Existing static tooling/baseline limitations are unchanged.

### Goblin Warrior live acceptance scenario — passed 2026-09-27

- Owner supplied the retest transcript after the `dadbb14` package handoff. The unchanged request asked for Goblin Warrior from the D&D Monster Manual, AC and HP, without modifications.
- Observed sequence: 12 source packages → four Monster Manual packs → one exact match in `dnd-monster-manual.actors` → read Goblin Warrior → final answer AC 15 and HP 10. No owner correction or mutation tool call appears in the supplied transcript. These values match the owner's preceding direct Foundry comparison of the same Actor.
- Outcome: **This end-to-end scenario passed the observed live run**. Source discovery, exact source-qualified identity handoff, and the final mechanical-stat answer now compose successfully in the reported Foundry v14/D&D5e 6.0.5/qwen3:14b environment. A transcript is not a complete side-effect audit, repetition study, or validation of every document/system.
- Scope: documentation only. No additional implementation or new task is authorized by this result. Broader H7 security validation, M10, direct pack-read permissions, other acceptance scenarios, and final overall acceptance remain open. Await owner acceptance/next-task direction.

### Ambiguous-name and missing-field recovery repair — 2026-09-28

- Authorization: after the owner supplied actual search/read results for the source-unspecified Goblin Warrior request, the owner stated: “I accept you fixing this issue.” Scope is ambiguity reporting and bounded actual-field correction feedback. Other paused work remains paused.
- Additional live evidence before this repair: a fresh Skeleton request selected the Monster Manual, recovered from READ_TOO_LARGE with a selected-field read, and answered AC 14 / HP 13. The owner's screenshot distinguishes the installed DMG Skeleton (AC 13 / HP 13) from the MM Skeleton (AC 14 / HP 13). A subsequent Goblin Warrior follow-up searched the MM pack and answered AC 15 / HP 10. These observed scenarios passed; they do not establish general reliability. An earlier Skeleton follow-up narrated discovery and went idle without visible calls; that termination/recovery issue remains open and is not changed here.
- Confirmed failed scenario: without an explicit source, broad search returned six entries: Goblin Warrior and Hobgoblin Warrior in each of dnd5e.actors24, dnd-heroes-borderlands.actors, and dnd-monster-manual.actors. The tool reported generic results and instructed selection, because ambiguity handling depended on the model setting exact=true. The model arbitrarily read the SRD Actor and requested system.hp.value. The read correctly identified that path as missing, but its nearest-parent list only exposed system.attributes among many children; the model stopped without recovering. Neither response was compacted in this evidence.
- Disposition: **Small fixes at existing tool boundaries**. Default/name-only broad search now detects two or more complete-name matches (trimmed, case-insensitive), reports ambiguity, and returns those identities separately from substring matches. Candidate source/package titles use installed metadata. Ambiguous results request clarification and omit ready-to-use read_document actions; selected/ordinary results retain the existing handoff. Same IDs in different packs remain distinct. Custom content-field searches retain broad behavior. One observed exact match inside capped broad results is not declared unique.
- Missing-field feedback: reuse the existing hint response to suggest actual paths containing the missing suffix within two nearby object levels, at most 100 visited/queued objects, 100 inspected keys per object, and five suggestions per hint. Own data properties only; avoid getters, arrays and cycles. For the observed system.hp.value error, system.attributes.hp.value is suggested when it exists. No aliases, D&D formulas, guessed values, automatic substitution, new tool, or new index. A separate explicit read is still required to obtain the value. Existing five-hint and read-output limits remain.
- Verification: regression 88/88, integration 27/27, security 27/27, package 1/1, policy, syntax and whitespace checks passed. New behavioral tests cover the six-result/three-source case, same IDs across packs, exact versus substring names, capped non-uniqueness, actual prepared HP correction and explicit retry, getters/cycles and bounded alternatives. A real registry/dispatcher/ConversationManager integration fixture verifies all three source choices and clarification guidance reach persisted model-facing history without generic compaction. Existing handoff tests were updated for the intentional ambiguity contract; ordinary broad partial-name handoffs remain tested.
- Limits: this is an explicit response contract, not a dispatcher-enforced selection lock. The model can still construct a read or ignore clarification; live qwen retesting is required. Search caps can hide additional duplicates, and sufficiently large ambiguity sets may still reach generic compaction. Field suggestions are bounded/nonexhaustive and do not resolve semantic aliases. No claim is made that all missing-stat recovery or narrated-but-unexecuted actions are fixed. Existing absent ESLint dependencies, DocumentAPI size-baseline failure, direct pack-read permissions, H7, M10 and final acceptance gates remain unchanged.
- Status: **Implemented and locally verified; awaiting installation/retest and owner acceptance**. Next live test: fresh conversation, source-unspecified Goblin Warrior AC/HP request; expect source clarification before a selected answer. Then choose Monster Manual and verify source-qualified AC 15 / HP 10. This task does not authorize unrelated development.

### Live ambiguity retest and complete-choice follow-up — 2026-09-27 (owner local time)

- The owner installed the `0e5b00a` package and ran a fresh source-unspecified Goblin Warrior AC/HP request. The assistant correctly stopped after reporting an ambiguous exact name, offered `dnd5e.actors24` and `dnd-heroes-borderlands.actors`, and asked for a source; no read or mutation is shown. This validates the non-arbitrary-selection behavior in that run.
- The offered list was incomplete: the installed `dnd-monster-manual.actors` pack has the same exact name but was omitted. The live tool display said “at least two matches”; the model restated that as exactly two. Repository trace found `DocumentSearchTool` caps exact mode at two, and `DocumentAPI.searchDocuments` stops at that cap in traversal order. This is a same-task ambiguity-contract gap, not evidence that the Monster Manual disappeared or a permission failure.
- Follow-up within the authorized ambiguity repair: exact mode now checks up to ten matches and reports `limitReached` and “at least” when ten are returned. The guidance explicitly says further matches may exist and recommends source discovery if the requested source is absent. The result remains bounded; no new service/index or automatic choice is introduced. A three-source integration fixture verifies the Monster Manual appears in persisted model-facing history without compaction, and regression coverage tests complete choices below the cap plus incomplete-choice wording at the cap. Verification: regression 89/89, integration 28/28, security 27/27, package 1/1, policy, syntax and whitespace checks passed.
- Live acceptance remains **pending** for the revised package. The desired retest is the same fresh request: all three known Goblin Warrior sources should appear, including Monster Manual, followed by a source clarification. Choosing Monster Manual should still yield prepared AC 15 / HP 10. The earlier narrated-but-idle loop and other paused gates remain open.

### Installation verification for complete-choice follow-up — 2026-09-27 (owner local time)

- After an attempted install/restart of `3530f39`, the same old tool display appeared: “Ambiguous exact name (at least two matches)” and only the SRD/Borderlands sources. This exact wording exists in the earlier two-result code, whereas `3530f39` renders a counted status and checks ten matches.
- A read-only console check in the owner's Foundry game fetched `/modules/simulacrum/scripts/tools/document-search.js` with a cache-busting query and HTTP `cache: no-store`, then inspected the imported browser module. HTTP status was 200; both `serverHasTenMatchFix` and `browserHasTenMatchFix` were false. The packaged `3530f39` ZIP was independently checked and contains the ten-result expression. The active server is serving an older module file; this run cannot validate the revised ambiguity behavior. It does not point to a model or search-algorithm regression in `3530f39`.
- `module.json` remains version 1.1.0 and its manifest/download URLs point to upstream `Daxiongmao87/simulacrum-foundry` 1.1.0. The Foundry module manager's ordinary Update action therefore cannot be assumed to install this branch's ZIP. Confirm that the replacement files land in the active Foundry user-data `Data/modules/simulacrum` directory, particularly `scripts/tools/document-search.js`; then restart and reload. Repeat the read-only server/browser code check before the acceptance prompt. Actual hosting/data-path configuration is unknown and must be identified in the owner's environment.
- Status: **deployment blocked; live validation of `3530f39` pending**. No further code change is indicated by this diagnostic. Existing broader gates remain open.

### Complete source-choice live retest — 2026-09-28 (owner local time)

- After installing the corrected package, the owner repeated the fresh source-unspecified Goblin Warrior AC/HP request. The live tool reported “Ambiguous exact name (3 matches)” across all accessible sources and the assistant presented all three exact-name source choices: `dnd5e.actors24`, `dnd-heroes-borderlands.actors`, and `dnd-monster-manual.actors`. It waited for the owner to select one, with no read or mutation shown.
- Outcome: **The ambiguity/source-choice step passed in this observed run**. The ten-match correction resolved the previously truncated list for this request. The source-qualified read and final AC/HP response after a clarification have not yet been observed in this continuation; that acceptance step remains pending. This transcript alone does not prove general behavior under more than ten exact hits or broad search limits.

### Monster Manual clarification and HP path recovery — 2026-09-28 (owner local time)

- In the successful three-source ambiguity conversation, the owner selected “Dungeons & Dragons Monster Manual.” The assistant issued a `read_document` call and reported prepared AC 15 but claimed HP was unavailable after requesting `system.health.hitPoints.value`. The earlier owner-inspected Actor has prepared `system.attributes.hp.value = 10`. The visible transcript establishes wrong field-path selection and an incomplete final answer; raw tool-call/result details and complete side-effect audit were not supplied.
- Local reproduction with the prepared Actor shape: the existing literal-suffix field hint for `system.health.hitPoints.value` lists `system.attributes` as an available child but returns no suggested path. The prior repair only handled an inserted parent segment such as `system.hp.value` → `system.attributes.hp.value`; it did not handle the model's `health.hitPoints` naming. The model's speculation about `system.details` was unsupported by a read.
- Focused continuation of the already authorized missing-field recovery work: for D&D5e Actors only, a missing explicit `system.*` path containing an `hp` or `hitPoints` segment can suggest `system.attributes.hp.value` **only if that own data path actually exists** in the prepared/stored read source. The hint reports a path, never substitutes or returns its value; the model must call `read_document` again with that path. Other game systems and unrelated fields retain structural hints. This is one concrete system path at the existing read boundary, not a generic alias framework, schema dump, or game-rule calculation.
- Behavioral regression exercises the live-shaped wrong path, actual prepared HP, an explicit corrected retry, no value in the first response, getter/cycle safety, and absence of a D&D5e hint for other systems. Verification: regression 89/89, integration 28/28, security 27/27, package 1/1, policy, syntax and whitespace checks passed. This local result does not prove qwen will follow the hint; another live clarification/read retest is needed. The previously observed source-choice step passed, while the end-to-end AC/HP scenario remains **open**.

### Source-unspecified Goblin Warrior clarification → read — live result, 2026-09-28 (owner local time)

- After installation of the `0bbe93b` package, the owner repeated the source-unspecified request in a fresh conversation. Search reported three exact-name sources and asked for clarification. The owner selected Dungeons & Dragons Monster Manual. The assistant's first `read_document` call failed with `UNKNOWN_ERROR: Use either view or fields, not both`; it then made a second successful read of Goblin Warrior and answered **AC 15, HP 10**. These facts match the owner's direct prepared Actor inspection. No mutation call appears in the supplied transcript.
- Outcome: **This end-to-end answer passed in the observed run, with one recoverable invalid tool call**. The transcript does not include raw read arguments/results, so it does not establish whether the new HP field hint was exercised; the successful retry may have supplied the correct path directly. Do not claim a live pass specifically for the hint. A visible read-only instruction and no visible mutation calls are not a complete side-effect audit.
- New contract candidate, tracked only: the `read_document` schema offers `view` and `fields` as optional properties, while runtime forbids their combination. The local code classifies that predictable input error as `UNKNOWN_ERROR`. This mismatch cost one tool round in the observed qwen run. Investigate whether the provider accepts an exclusive schema constraint or whether a small normalization/validation change at the existing boundary is more reliable; do not add a new tool or broad correction framework. No implementation of this separate cleanup is authorized by this live result.
- Scope: other acceptance scenarios, the earlier narrated-but-idle follow-up, direct pack-read permissions, H7 and M10 remain open. This observed AC/HP success does not close the overall stabilization plan.

### Same-conversation Skeleton follow-up — live result, 2026-09-28 (owner local time)

- Immediately after the successful clarified Goblin Warrior answer, the owner asked in the **same conversation** for the Skeleton from the D&D Monster Manual, AC and HP, without modification. The assistant searched `dnd-monster-manual.actors`, received one exact match with identity-only guidance, read Skeleton, and answered **AC 14, HP 13**. These values agree with the owner's earlier MM versus DMG screenshot (MM AC 14 / HP 13; DMG AC 13 / HP 13). No mutation tool appears in the supplied transcript.
- Outcome: **This sequential read-only follow-up passed in the observed run**, including source continuity, new search/read, correct facts, and a final answer. The earlier narrated-then-idle follow-up was intermittent and is not explained or closed by one successful repetition. The transcript does not include raw tool arguments or a complete side-effect audit. The recoverable `view`+`fields` mismatch observed on the preceding Goblin read remains a tracked candidate, not an implemented change.

### Two-source Skeleton comparison — live result, 2026-09-28 (owner local time)

- In a fresh conversation, the owner asked for Skeleton Actor AC, HP, and exact pack IDs from the D&D Monster Manual and the 2024 Dungeon Master's Guide, without mutation. The assistant listed 12 source packages, then four MM packs and seven DMG packs; it eventually exact-searched `dnd-monster-manual.actors` and `dnd-dungeon-masters-guide.actors`, read both Skeleton Actors, and reported MM **AC 14 / HP 13** and DMG **AC 13 / HP 13**, each with its correct pack ID. These values match the earlier owner screenshot. No mutation call appears in the supplied transcript.
- Outcome: **This multi-step read-only comparison passed in the observed run**, including separate provenance and two reads. Before the successful searches, two `search_documents` calls failed with `SEARCH_FAILED: Specify either source or pack, not both`. The model recovered, but the duplicate rejected calls consumed time/context. The tool schema exposes both `source` and `pack` as optional properties and explains the exclusion only in prose; the DocumentAPI runtime rejects their combination. This repeats the kind of mutually exclusive parameter issue seen with `read_document(view, fields)`. The final speculation that the AC discrepancy “may reflect variant rules or errata” is not supported by the retrieved Actor fields or the screenshot and must not be treated as an established explanation.
- Track as one contract-cleanup candidate: assess whether the model-facing schema can expose one unambiguous selector for exact pack searches while retaining any needed world and broad-search behavior; keep runtime rejection for conflicting direct callers unless a deterministic choice is proven safe. Also classify invalid input as such rather than `UNKNOWN_ERROR` where relevant. Prefer removing redundant options or a small boundary fix over adding a corrective framework. This transcript authorizes documentation of the finding, not a new code task. Other runtime/security gates remain open.

### Exact arguments for two-source search failures — 2026-09-28 (owner local time)

- The owner supplied persisted calls for the Skeleton comparison. The first two `search_documents` calls used `exact:true`, `documentTypes:["Actor"]`, and respectively `pack` and `source` both equal to `dnd-monster-manual.actors` or both equal to `dnd-dungeon-masters-guide.actors`. Both returned `SEARCH_FAILED: Specify either source or pack, not both`. The retries omitted `source`, retained the same `pack` IDs, and succeeded. The two subsequent `read_document` calls used only `fields:["system.attributes.ac.value","system.attributes.hp.value"]` with the correct pack and document ID (`mmSkeleton000000` versus `dmgSkeleton00000`).
- This narrows the search contract candidate: the observed duplicate selectors are identical exact IDs. A small normalization at the tool boundary could drop one identical selector while preserving the existing rejection of conflicting IDs/titles. Do not silently choose between different selectors or infer module names. A schema description should prefer the discovered `pack` ID when available. Whether this normalization merits implementation still requires owner authorization; no code changed in this diagnostic.
- These six calls do not include the earlier Goblin `view`+`fields` failure. Its actual arguments remain unknown. Do not apply the duplicate-selector rule to distinct read modes; the current explicit rejection protects against conflicting read intent.

### Redundant exact pack selectors — authorized fix, 2026-09-28 (owner local time)

- Authorization: after receiving the exact six-call Skeleton diagnostic and the concrete proposal, the owner stated “I accept.” Scope is the observed `search_documents` calls with identical installed pack IDs supplied as both `source` and `pack`. The earlier read `view`+`fields` error and unrelated development remain separate.
- Disposition: **Small normalization at the existing search tool boundary**. If the two selector strings are identical and identify an installed pack, forward the `pack` ID and omit redundant `source`. Otherwise retain DocumentAPI's conflict rejection, source-title ambiguity checks, pack permissions, and existing world behavior. The model-facing `source` description now instructs use of `pack` alone when discovery supplied its ID. No new selector/index/router, implicit source choice, or global alias behavior was added.
- Regression reproduces the two-source identical-ID calls using real DocumentAPI search, checks both source-qualified read handoffs, and verifies mismatched IDs, same titles without pack identity, unknown identities and hidden packs do not bypass validation/permissions. Verification: regression 90/90, integration 28/28, security 27/27, package 1/1, policy, syntax and whitespace checks passed. The supplied live calls had already recovered without this fix; live validation of the fewer-call path is still pending.

### Two-source comparison retest after selector normalization — 2026-09-28 (owner local time)

- Following installation of `354b3bd`, the owner reran the fresh MM versus DMG Skeleton comparison. The assistant called `list_documents(documentType="Compendium")` twice and received 12 source packages each time. It then narrated listing each source's actors, but both `list_documents` calls failed with `LIST_FAILED: Unknown compendium pack: dnd-monster-manual` and the corresponding `dnd-dungeon-masters-guide`. The loop ended with “I could not verify completion” and no search, read, values or mutation call appears in the supplied transcript.
- Outcome: **The new packageId/pack handoff failed; this run did not exercise the authorized redundant `search_documents` selector fix**. `list_documents` has distinct modes: `documentType="Compendium", packageId=<module ID>` lists that package's pack IDs, while `pack=<pack ID>` targets documents in one actual pack. The displayed failures are consistent with using module IDs as pack IDs, but raw arguments are required to establish exactly what was sent. Source catalog guidance already distinguishes those IDs, and the previous comparison successfully navigated that boundary, so do not infer a systematic Foundry pack disappearance or regression in the search change.
- Track this as a separate source-to-pack contract candidate. Capture the failed `list_documents` arguments, then determine whether a deterministic exact package-ID handoff using existing `DocumentAPI.listPacks()` is warranted. Do not silently choose among multiple Actor packs or change the search selector normalization based on this unrelated failure. No implementation is authorized by this report; the original live acceptance remains pending.

### Confirmed arguments for failed package-to-pack handoff — 2026-09-28 (owner local time)

- The owner supplied all four `list_documents` argument objects. The first two were `{documentType:"Compendium", filters:{name:"Monster Manual"}}` and the analogous DMG filter. Both produced the entire 12-source catalog; Compendium source discovery does not consume `filters`. The subsequent failures were exactly `{documentType:"Actor",pack:"dnd-monster-manual"}` and `{documentType:"Actor",pack:"dnd-dungeon-masters-guide"}`. These `pack` values are owning package IDs, not `dnd-monster-manual.actors` and `dnd-dungeon-masters-guide.actors`.
- Root cause at the component boundary: the catalog emits `packageId`, but the model supplied it to the document-list `pack` parameter, which expects an actual compendium pack ID. The listing tool then forwarded the package ID to DocumentAPI and returned `LIST_FAILED`; after two such failures the loop stopped. The source filters were ignored by the discovery branch, adding two redundant catalog calls, but the bounded 12-source output was still usable. This report does not test the recently normalized duplicate `search_documents` selectors.
- Candidate small fix for separate authorization: when `list_documents` receives a `pack` string that is **not** an installed pack ID but **is** an exact readable owning `packageId`, and no document filters are requested, reuse its existing bounded `listCompendiumSources({packageId})` response to return that source's pack choices. Do not guess/select an Actor pack or load documents. Preserve normal document listing for actual pack IDs and explicit failure for unknown/hidden IDs; avoid silently dropping requested filters. Measure whether this simple correction eliminates the observed loop termination before broadening it. No code implementation was authorized by these diagnostic arguments.

### Exact package ID supplied as document-list pack — authorized correction, 2026-09-28 (owner local time)

- Authorization: after reviewing the four exact `list_documents` arguments and a bounded correction proposal, the owner said “Please continue.” Scope is the confirmed package-ID-as-pack-ID handoff. No other listing/filter or loop behavior is authorized by this task.
- Disposition: **Reuse existing bounded source pack discovery**. For a document listing request with `pack` equal to an exact readable owning `packageId` but no readable actual pack of that ID, and with no document filters or `includeCompendiums:true`, `DocumentListTool` returns its existing `listCompendiumSources({packageId})` metadata page. It does not pick the Actor pack, load documents or infer a source name. Actual pack IDs retain document listing; unknown/hidden IDs and requests whose filters would otherwise be discarded still follow the old error path. The pack parameter description now distinguishes package and pack IDs.
- Behavioral verification includes a real registry/dispatcher/ConversationManager fixture with the two observed module IDs, 12 source packages, bounded persisted results below compaction, and no index reads. A separate fixture checks exact pack document listing and rejects unknown/hidden packages and filtered requests. Verification: regression 90/90, integration 29/29, security 27/27, package 1/1, policy, syntax and whitespace checks passed. The earlier duplicate selector search fix remains implemented but needs a new live run that reaches `search_documents` to validate its effect. The Compendium catalog currently ignores `filters.name`; that redundant discovery behavior was observed and remains a separate candidate rather than being silently changed here.

### Two-source comparison retest on `0e44dec` — 2026-09-28 (owner local time)

- The owner installed the package-ID listing correction and reran the fresh MM versus DMG Skeleton comparison. The visible sequence was one 12-source catalog; MM's four packs and DMG's seven packs; searches scoped to `dnd-monster-manual.actors` (four substring matches) and `dnd-dungeon-masters-guide.actors` (one match); two reads of Skeleton; final MM **AC 14 / HP 13**, DMG **AC 13 / HP 13**, with the correct pack IDs. No `LIST_FAILED`, `SEARCH_FAILED`, or mutation call is visible in the supplied transcript.
- Outcome: **The multi-step source discovery → pack selection → separate reads → comparison passed in this observed run**, including the correct distinction between the two installed Actor sources. The transcript does not show raw arguments or result candidates, so it does not establish whether the new package-ID fallback or identical-selector normalization was exercised; the model may have supplied valid arguments directly. A broad MM search returned four matches before the selected read, so the exact search-to-read identity is not independently proven by this transcript alone.
- The final statement that the AC difference “may reflect variant rules or errata” remains unsupported speculation; neither read establishes a reason for the difference. Track it as an answer-grounding observation, not as a verified rules conclusion or authorization to add a new model-control framework. Other acceptance and security gates remain open.

### Existing artwork read — live result, 2026-09-28 (owner local time)

- In a fresh conversation, the owner requested the Goblin Warrior's existing portrait image path, prototype token image path, and compendium pack from the D&D Monster Manual, explicitly excluding alternative artwork searches and modifications. The assistant discovered 12 source packages and four MM packs, exact-searched `dnd-monster-manual.actors`, read the selected Goblin Warrior Actor, and reported portrait `modules/dnd-monster-manual/assets/portraits/goblin-warrior.webp` and token `modules/dnd-monster-manual/assets/tokens/goblin-warrior.webp`, with pack `dnd-monster-manual.actors`.
- Outcome: **The source-qualified existing-artwork workflow passed in the observed transcript**. No `search_assets` or mutation tool call appears; the read supplied the paths used in the answer. The transcript does not include the raw read payload or an independent Actor inspection, so it does not separately verify that the returned file paths match the installed document or prove absence of side effects beyond visible calls. No code change follows from this observation. Alternative-artwork behavior and the separate M10 asset index runtime gate remain open.

### Explicit alternative portrait search — live result, 2026-09-28 (owner local time)

- In a fresh conversation, the owner requested the same Monster Manual Goblin Warrior's current portrait and prototype token paths plus up to three alternative portraits, without modification. The assistant discovered the Monster Manual package and its packs, exact-searched `dnd-monster-manual.actors`, then received `READ_TOO_LARGE` on its first `read_document`. It retried with specific image fields and reported the same current portrait and token paths as above. It called `search_assets` for `goblin warrior portrait`; the displayed result said no matching assets in an index of 8,719 files and described the search as user-uploaded assets. No mutation appears in the supplied transcript.
- Outcome: **Scenario G's explicit alternative-search routing passed in this observed run**: existing artwork did not prevent an asset search, and the assistant distinguished current paths from the absence of returned alternatives. The failed broad read cost an extra tool call and remains a bounded-read efficiency observation, not a data-correctness failure. The result establishes no matches for that query in the searched index; it does not establish that no other portraits exist in module assets, under different names, or outside the indexed scope. The final assertion that the Monster Manual has no additional portrait variations and that these are the only associated paths exceeds the visible evidence. Raw tool payloads and independent inspection were not supplied, so index coverage, actual stored paths, and all side effects are not independently verified. M10's asset indexing/lifecycle assessment and final acceptance remain open; no code change is authorized by this result.

### M10 asset-search coverage inspection — 2026-09-28 (owner local time)

- Scope: owner directed continuation of the immediately proposed M10 assessment. Source inspection only; no application code changed. `AssetIndexService.rebuildIndex()` traverses data roots `assets`, `modules`, `systems`, `worlds` and public roots `icons`, `sounds`. Its `search()` scans the IndexedDB `files` store and accepts a result only if the *entire lowercase query string* is a substring of the filename or full path; `type` applies an extension filter and `source` separates path-prefix-derived `data`/`public`. `AssetSearchTool` displays `stats.fileCount`, the index's total count, even if a source filter is supplied. Therefore the observed 8,719 figure does not state how many files met the source filter, and the phrase `goblin warrior portrait` cannot match a hyphenated path such as `modules/dnd-monster-manual/assets/portraits/goblin-warrior.webp` under this literal matching rule. The transcript did not expose the `search_assets` arguments, so its actual `source` and `type` filters remain unverified.
- This explains why a zero-result query is insufficient to judge asset coverage or prove the absence of alternatives. The descriptor calls the `user` source “uploaded assets and module files,” while source classification also includes `systems` and `worlds`; the assistant's “user-uploaded assets” wording does not establish a limited upload-only search. The index has no tokenization, synonyms, or name normalization. Do not add any of those without a demonstrated need; simpler filename/path queries are available now.
- Next read-only live measurement: compare the actor's actual `img` and `prototypeToken.texture.src` with exact-path and shorter-name searches in the running browser; capture index age/count and per-search latency. Then assess a normal upload, repeat upload, interrupted rebuild/reload, and stale/external change separately before M10 closure. A mismatch between previously logged ~15,939 files and this run's 8,719 may reflect a different build, time, browser cache, or incomplete traversal; do not infer index loss without measurements. The existing swallowed browse errors and path-derived source identity remain candidates, not newly authorized fixes. **M10 remains open.**

### M10 actual-path and search measurements — 2026-09-28 (owner local time)

- The owner ran a read-only browser check against `Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior0`. Prepared Actor fields confirmed `img=modules/dnd-monster-manual/assets/portraits/goblin-warrior.webp` and `prototypeToken.texture.src=modules/dnd-monster-manual/assets/tokens/goblin-warrior.webp`, independently confirming the two paths previously reported by Simulacrum. With `type="image"` and `source="user"`, exact-path index searches found one hit for each current image (71 ms and 61 ms); `goblin-warrior` found 13 hits (62 ms), including both current images; `goblin warrior portrait` found zero (60 ms); and `goblin` found 91 (76 ms). The first five broader hits included module artwork from Heroes of the Borderlands and the Dungeon Master's Guide. These observations establish that module artwork is included in the searched `user` source and confirm literal-query mismatch as the reason the phrase cannot retrieve the known current image. They do not determine whether any particular broader hit is a suitable alternative portrait.
- The same snapshot reported 8,719 files, 509 folders, `lastIndexTime=2026-09-28T16:56:47.064Z`, and **`isIndexing:true`**. These are one client's in-progress counters, not a completed-index coverage measurement; cursor results during a rebuild may reflect a partial pass because the rebuild clears and repopulates the stores. The 60–76 ms timings are five observations during this build, not a steady-state latency benchmark. Next capture the completed index count/time and repeat the exact-path and short-name queries after `isIndexing` becomes false. Do not attribute the earlier ~15,939-versus-8,719 count difference solely to missing files or to index corruption. Normal/repeat upload, interrupted rebuild/reload, and external change checks remain outstanding. **M10 remains open; no code change follows from this snapshot.**

### M10 repeat snapshot during rebuild — 2026-09-28 (owner local time)

- About three minutes after the preceding live sample, the owner reran the read-only completion check. It exited before searching because `isIndexing` was still `true`. The counters remained exactly **8,719 files and 509 folders** and `lastIndexTime` still showed **2026-09-28 12:56:47 Eastern** (16:56:47 UTC), approximately 33 minutes before the repeat check. This is evidence of no *reported* progress between samples and a possibly stalled rebuild, not proof of a deadlock or identification of the pending directory/request. The service does not expose its current traversal path or elapsed rebuild time; a pending `FilePicker.browse` can hold `_indexRecursive` without a timeout, while the heartbeat skips further work whenever `isIndexing` is true.
- Next use a short read-only before/after sample of both service counters and IndexedDB store counts. If unchanged, inspect pending browser network requests and console errors before deciding whether a reload is appropriate. Do not call `rebuildIndex()`, clear IndexedDB, or modify installed files as part of this diagnostic. **M10 remains open.**

### M10 unchanged service and IndexedDB counts — 2026-09-28 (owner local time)

- Two independent 15-second browser samples at 17:31:33–48 UTC and 17:32:38–53 UTC each reported `isIndexing:true`, unchanged in-memory and IndexedDB counts of **8,719 files / 509 folders**, and unchanged `lastIndexTime=16:56:47.064Z`. The service and database counts agree, so this is not merely an out-of-date displayed counter. No new indexed records appeared over either interval or between them. The interval starts approximately 35 minutes after the last completed index; the actual rebuild start time was not captured. This is strong evidence of a stalled or very long blocked rebuild in this client's current session, though it does not identify the waiting operation.
- Source path: `rebuildIndex()` sets `isIndexing=true`, clears the stores, walks six roots sequentially, and resets the flag only after all walks and timestamp write. `_indexRecursive()` awaits `FilePicker.browse` and IndexedDB batch writes; it does not report the current directory or set a request timeout. `_checkStaleness()` skips any subsequent rebuild while the flag is true. The missing top-level `try/finally` also means a synchronous/unhandled error outside the localized catches can leave the flag set. Distinguish a pending browse, batch transaction, or exception from browser Network/Console and the IndexedDB `meta` completion marker before selecting a fix; do not add a broad watchdog solely from unchanged counts. The read-only index was still usable for known images during this in-progress state, but full coverage cannot be certified. **M10 remains open; no application code change authorized by this measurement.**

### M10 completion marker and refresh recovery — 2026-09-28 (owner local time)

- Later in the same browser session, two read-only meta checks found `hasEverIndexed:null` and persisted `lastIndexTime:null` while service state was `isIndexing:true`, **0 files / 0 folders**, with in-memory `lastIndexTime` showing 15:54:36 Eastern. The timestamp was from an earlier successful pass; the null IndexedDB markers show that a subsequent rebuild had cleared its completion state but had not committed a replacement. Zero indexed files while indexing is significant because `getAvailability()` does not report an empty index as unavailable when `isIndexing` is true; searches from an already-ready session can therefore receive incomplete or empty results. The exact pending operation and timing of the zero-count transition were not captured. An earlier 8,719-file stalled snapshot and this later zero-file snapshot do not prove one continuous blocked rebuild: a successful intervening index is consistent with the changed in-memory completion timestamp.
- The owner then refreshed the page. Immediately after reload the new index reported 7,539 files / 399 folders, `isIndexing:true`, no completed timestamp or marker. Console subsequently logged progress at 9,491 files / 537 folders and **`Index rebuild complete: 15954 files, 668 folders indexed in 33557ms`**. Thus reload-triggered rebuilding reached the completion path in about 33.6 seconds in this environment. The supplied transcript did not include a post-completion `getStats()`/meta read; the completion log follows an attempted timestamp write (whose error is caught) and `isIndexing=false` in source, so persisted completion metadata is not independently confirmed. This is operational recovery, not root-cause identification.
- M10 remains **open**: a periodic rebuild can leave the live index cleared or partial, and the current evidence does not distinguish a pending browse, IndexedDB transaction, unexpected exception, or other interruption. Before selecting a minimal remediation, capture browser Network/Console evidence during a recurrence or add narrowly scoped diagnostics with explicit owner approval. Do not infer that the refresh permanently fixes the problem, claim steady-state coverage from the earlier zero-result alternative query, or implement a watchdog/atomic swap without a scoped design and authorization. No application code changed in this diagnostic.

### M10 in-progress search containment and stall diagnostics — authorized 2026-09-28

- Authorization: after the above live evidence and a narrow reliability proposal, the owner said “I approve.” Scope: investigate the rebuild wait, provide diagnostics for a recurrence, prevent a partial rebuild from being returned as a complete search, test interruption/reload behavior, and avoid unrelated indexing redesign.
- Disposition: **Small containment in existing service/tool boundaries**. Indexed file/folder searches now report `INDEX_UNAVAILABLE` while `isIndexing` is true, including a rebuild that begins during an IndexedDB cursor pass; a cursor error fails rather than returning a potentially partial list. Actual folder browsing still goes directly through FilePicker. `getStats()` exposes the current traversal path, browse/write phase and last progress time, and the existing 10-second heartbeat logs one warning after two minutes without a completed directory batch. A short literal-fragment description in `search_assets` explains the observed space-versus-hyphen behavior. No new index, retry loop, timeout, cancellation mechanism or background worker was introduced.
- Tradeoff and limits: while a normal full rebuild runs (33.6 seconds in the observed refresh), indexed search is temporarily unavailable; that favors honest failure over false “no assets found.” This containment **does not prevent a rebuild from stalling**, preserve the old index during rebuild, or diagnose the historical pending operation retroactively. A `FilePicker.browse` or IndexedDB write can still remain pending; swallowed subtree errors and a failed metadata write can still affect completeness after a nominal finish. M10 remains open pending live recurrence evidence and owner review. Do not claim this as a complete fix to indexing reliability or authorize a new framework from it.
- Behavioral regression checks exercise both tool-level unavailable results, direct service calls, a rebuild starting during an active cursor search, normal completed-index search, cursor failure, the once-per-stall warning, and existing reload/metadata recovery. Verification: policy passed; regression **95/95**, integration **29/29**, component **1/1**, security **27/27**, package **1/1**, syntax and whitespace checks passed. The full static tier remains blocked by absent ESLint dependencies (`eslint-baseline-check` receives empty JSON); its independent file-size gate still fails on the pre-existing `document-api.js` 1,683-line size versus 1,636-line baseline, not on this change. Unit tier had **29/31** pass; two unit test modules cannot import absent `@playwright/test`. Do not present those tiers as passing. Live installed Foundry v14 validation, post-rebuild tool availability, and stall diagnostic output are still pending; owner acceptance is pending.

### M10 normal asset-search retest after package handoff — 2026-09-28 (owner local time)

- The owner requested image asset paths containing `goblin-warrior`, up to five, with no modification. The visible Simulacrum turn called `Search Assets`, displayed **13 matches**, and answered with five paths beginning `modules/dnd-heroes-borderlands/assets/journal-art/goblin-warrior.webp`, `.../hobgoblin-warrior.webp`, `.../portraits/hobgoblin-warrior-portrait.webp`, and two subject images. These are the same first five paths and 13-match count found in the earlier direct browser index search for the same literal fragment. No mutation call or error is visible.
- Outcome: **The ordinary indexed-search and answer path passed in this observed run**. The transcript does not show the raw `search_assets` arguments, an installed-build fingerprint, current `getStats()`, or a rebuild at the time of the call. It therefore does not independently prove the new `INDEX_UNAVAILABLE` branch, a completed persisted marker, or recovery from the intermittent stall. Retain M10 as open and do not require the owner to force a rebuild merely to exercise the transient branch; capture a natural recurrence or use a controlled live check if justified and authorized. No code changed from this retest.

### M10 screenshot clarifies search timing — 2026-09-28 (owner local time)

- The owner reported starting the above prompt during indexing and supplied a screenshot of the final answer and console. The console displays `Indexing progress: 9489 files, 537 folders`, then `Index rebuild complete: 15952 files, 668 folders indexed in 35553ms`, then a `ToolLoop` warning that `search_assets` lacked a `justification` parameter. The UI shows the five paths and says 13 total matches. This is consistent with the search tool call occurring **after** rebuild completion even though the owner submitted the request during indexing; the visible console order does not establish a transient `INDEX_UNAVAILABLE` result. A model/tool-loop delay of roughly the build duration is plausible but not independently timed here. The missing justification warning did not prevent this successful read-only search; track it separately if it causes a concrete failure.
- Outcome: **Completed-index search confirmed by the screenshot; in-progress search containment remains untested live.** The 15,952-file build differs by two from the earlier 15,954-file build and finished in 35.6 seconds versus 33.6 seconds; these snapshots alone do not show an indexing defect. The image does not include an installed-build fingerprint, meta marker, or stall warning. M10 remains open. No code change follows from this screenshot.

### H7 live browser validation resumed — 2026-09-28 (owner local time)

- Authorization: after M10's normal search, the owner asked for the next item, received H7 live rendering validation as the concrete recommendation, and replied “Authorized.” Scope is to verify the existing display boundary in Foundry v14, not to introduce a new sanitizer or unrelated feature.
- The cloud browser was directed to the explicitly authorized `https://foundry.wampler.app/game`, but it returned only a generic **Site Unavailable / Unable to access this site** page. No Foundry sign-in, game DOM, or module UI was reached, and there is no evidence of a site-served bot challenge or of the owner's own session being unavailable. The owner's local screenshot and prior tests show their browser reached the game; this cloud route cannot substitute for that local session. A live H7 pass is not claimed.
- Repository boundary inspection reconfirmed that `sanitizeDisplayHtml()` imports the bundled DOMPurify ES module and falls back to escaped text if sanitization fails. `createDisplayMessage` and the sidebar's new-message, stream-chunk, pending-tool-card and result-card methods use this boundary. The inline confirmation template uses escaped Handlebars interpolations but its rendered HTML enters `innerHTML`; confirm its actual DOM behavior too. Existing Node security tests stub the sanitizer, so they cannot establish the installed browser behavior. Next use a **read-only, detached-DOM** probe in the owner's active Foundry browser for the real sanitizer and display methods, then inspect final/restored/stream/tool-card behavior without modifying game documents. H7 remains open pending that evidence and owner acceptance; no code change was made.

### H7 local-browser detached-DOM probe — 2026-09-28 (owner local time)

- The owner ran the read-only console probe in their Foundry browser against the installed module. It imported the actual `sanitizeDisplayHtml`, `createDisplayMessage`, and `SimulacrumSidebarTab` modules, then inspected detached DOM from direct sanitization, fresh and restored display messages, a streamed chunk, a pending tool card, and a result card. The payload contained `<strong>` text, an anchor with `javascript:void(0)` and `onclick="void(0)"`, and a safe `#h7-probe` anchor. No world document or conversation was changed by the probe.
- All six outputs contained **zero event attributes and zero `javascript:` URL attributes**. Each retained `<strong>` and the safe fragment link; the unsafe anchor's text remained while its unsafe attributes were removed. The pending card also preserved ordinary tool-card markup. This is direct browser evidence for those installed display boundaries and for useful formatting surviving sanitization, stronger than the Node tests that stub the sanitizer.
- Limits: this probe used one malicious payload and detached elements. It did not exercise Foundry link enrichment, the inline mutation-confirmation template, the actual mounted sidebar message/reload flow, or a malicious model/tool message arriving over Ollama. It did not establish the installed build fingerprint, exhaustive sanitizer behavior, or approval-button correctness. **H7 remains open** pending the confirmation path and proportionate real UI validation, then owner acceptance. No application code changed.

### H7 confirmation-template browser probe — 2026-09-28 (owner local time)

- The owner invoked the installed sidebar's `_showToolConfirmation` against a detached element with hostile `<a href="javascript:void(0)" onclick="void(0)">` text in the display name, explanation, justification and JSON arguments. The real Foundry Handlebars template was retrieved and compiled. No approval button was clicked and no game document was changed.
- The resulting DOM had **zero event attributes, zero script URL attributes, zero injected anchors**, and retained the payload as visible text. It contained the expected `allow`, `deny`, `always` and `blacklist` controls. This confirms the actual template's escaped interpolations for these tested fields, including through its `innerHTML` insertion. It does not test button behavior, arbitrary payloads or actual permission enforcement.
- The same console transcript showed a later server socket disconnect/reconnect and two completed asset-index rebuilds of 15,952 files / 668 folders in 34.9 and 33.8 seconds. These are not evidence of a rendering failure, and they do not identify the cause or resolve M10's intermittent stalled rebuild.
- **H7 remains open** for a small mounted-sidebar and actual Foundry-link presentation check and owner acceptance. The detached tests establish the tested browser boundaries; they do not by themselves certify the full live conversation lifecycle. No application code changed.

### H7 Foundry-link and mounted-sidebar inspection — 2026-09-28 (owner local time)

- The owner ran a read-only local browser check using the installed `processMessageForDisplay` and `sanitizeDisplayHtml` on `@UUID[Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior0]{Goblin Warrior}` plus bold Markdown. The resulting detached DOM retained an `a.content-link` with the **exact original compendium UUID**, the `Goblin Warrior` label, and a `<strong>` element. Thus the tested Foundry enrichment → sanitizer path preserved both the link identity and ordinary Markdown formatting.
- The same check found three currently mounted Simulacrum message-content elements and a mounted tool card. It reported `mountedFormattedMessage:false`, which means none of those three happened to contain `<strong>` at inspection time; this alone does not show formatting failure in a mounted message. A normal live response with deliberate bold text is still needed to observe that specific mounted path. It did not inspect a reloaded conversation or inject hostile content into the mounted sidebar.
- Additional console lines showed another completed 15,952-file / 668-folder index rebuild in 25.1 seconds followed by the start of a further rebuild. Without timestamps for every start and the current service/meta state, this transcript does not establish whether the five-minute staleness policy, page lifecycle, socket reconnection, or another trigger caused repeated starts. **M10 remains open**; investigate only under its own scope, not as an H7 rendering change.
- **H7 remains open** pending the small mounted-formatting check and owner acceptance. No application code changed.

### H7 mounted assistant formatting — 2026-09-28 (owner local time)

- The owner prompted the installed Simulacrum UI to reply with `H7 bold text` in bold Markdown and supplied a screenshot of the rendered sidebar and a read-only DOM inspection. The assistant's actual mounted reply is visibly bold. The console found two matching message-content elements: the user's instruction had `boldRendered:false` and the assistant reply had `boldRendered:true`. No tool was visible for this prompt. This resolves the earlier inconclusive `mountedFormattedMessage:false` observation for normal assistant Markdown.
- Combined H7 evidence now includes the installed browser's sanitizer on fresh/restored display objects, streaming chunks, pending/result cards, the real Handlebars confirmation template, Foundry UUID enrichment, and an actual mounted assistant response. The tested hostile URL/event attributes were removed while expected text, formatting, link identity and confirmation controls remained. The original literal-HTML presentation defect was separately corrected and retested earlier in this plan.
- Limits: hostile content was exercised in detached DOM, not delivered through a live Ollama tool result; the current screenshot does not prove persistence after a page reload or confirmation-button permission behavior. These are separate lifecycle/policy acceptance concerns. This H7 evidence is proportionate to the display-boundary mitigation, not proof against every possible HTML payload. **H7 is ready for owner acceptance of its scoped rendering mitigation; do not mark it resolved until the owner accepts.** M10 indexing and broader end-to-end acceptance remain open. No application code changed.

### H7 owner acceptance — 2026-09-28 (owner local time)

- Following the mounted-formatting evidence and explicit report that H7 was ready for acceptance, the owner stated **“I accept it.”**
- Status: **H7 resolved for the scoped sidebar display-boundary mitigation and browser validation described above.** This acceptance does not certify every possible hostile payload, live Ollama delivery of hostile tool output, persistence/reload behavior, confirmation-button permission enforcement, or release readiness; the applicable lifecycle/policy and final acceptance checks remain in the plan.
- M10 indexing reliability and other open findings remain separate. This acceptance does not authorize a new implementation task. No application code changed in this documentation update.

### M10 repeated-rebuild source review — 2026-09-28 (owner local time)

- Authorization: after accepting H7, the owner directed “Please continue.” This resumes the already authorized M10 reliability investigation; no unrelated implementation is inferred.
- Source behavior: the initialized service checks staleness immediately and every 10 seconds, starting a full rebuild when `lastIndexTime` is absent or more than five minutes old. A successful `rebuildIndex()` assigns a new in-memory completion time, attempts to persist `lastIndexTime` and `hasEverIndexed`, clears `isIndexing`, then logs completion. On page reload, `_checkExistingIndex()` requires both persisted markers to reuse a complete cache. A successful periodic build therefore can legitimately be followed by another after approximately five minutes; console ordering without timestamps cannot establish shorter cadence. If persistence fails, the current session still has an in-memory completion time but a subsequent session will rebuild.
- The recent owner console transcripts show several successful passes around 25–35 seconds and an additional `Starting index rebuild...`, but do not give the intervals between starts or the completion marker after each pass. They do not reproduce the earlier >35-minute no-progress case. A single read-only live sample of `getStats()`, `getAvailability()`, and the persisted metadata can determine whether the current rebuild completed and whether the cache marker exists; a timestamped follow-up during a natural repeat can determine cadence. Do not force a rebuild or change the refresh policy on these logs alone.
- **M10 remains open** for stall cause and lifecycle acceptance. This source review made no application code change.

### M10 completed-index and cadence snapshot — 2026-09-28 (owner local time)

- At `2026-09-28T21:55:34.273Z`, the owner's read-only Foundry browser snapshot reported **15,952 files / 668 folders**, `isIndexing:false`, no active path/phase, and `getAvailability(): {available:true}`. In-memory `lastIndexTime` and `lastProgressAt` were both `2026-09-28T21:50:40.003Z`. IndexedDB `hasEverIndexed` was `true` and `lastIndexTime` was `1790632240003`, the same instant. The completion marker therefore persisted successfully for this observed build; a reload could reuse this cache while it remains complete.
- The sample was about **4 minutes 54 seconds** after completion, just before the source's five-minute staleness threshold. The next heartbeat could legitimately start another rebuild shortly afterward. This explains why a new `Starting index rebuild...` line near that point is expected; it does not establish the exact elapsed interval for every earlier line or a failure. The observed repeated completed passes must not be conflated with the earlier >35-minute unchanged partial index.
- Outcome: completed-index availability and metadata persistence **pass in this snapshot**. The previous intermittent stall cause, rebuild behavior under a new stall, and upload/external-change lifecycle checks remain open under M10. Do not force a rebuild solely to recreate an intermittent issue; capture `getStats()` path/phase and the once-per-stall warning if it occurs naturally. No application code changed.
