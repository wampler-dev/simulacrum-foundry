# Stabilization development plan

Status: **Required scope; C1, C2, H1, H2, H3, H4, H5, H6, M1, M2, M3, M4, M5, M7, M8, and M9 owner-accepted for implemented code. H7 live validation is pending by owner direction. M6 implementation awaits owner acceptance. Work dependent on H7 waits; other tasks still require explicit owner permission.**
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
- Status: **Awaiting owner acceptance**. No other finding was closed.

### Newly observed candidate — pack read permissions (investigate with separate authorization)

- DocumentAPI.getDocument uses pack.getDocument(id) and returns its object without the module-level permission check used for world reads and pack search. It is uncertain whether Foundry v14 getDocument enforces the user’s pack/document read permission at this boundary. This was observed during M2 but no policy change was authorized or made.
- Before accepting any security claim for pack reads, test a hidden/restricted pack and a non-GM user in an authorized Foundry environment; if the host does not enforce it, add the smallest permission check at the actual boundary. Track this as a blocked candidate until separately authorized. Do not infer exploitability from source inspection alone.

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
