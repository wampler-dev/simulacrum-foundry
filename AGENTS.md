# Repository work instructions

## Mandatory development scope

Read [the stabilization development plan](docs/stabilization-development-plan.md) before proposing or performing development work.

The owner has made this plan the sole development priority until every finding has an evidence-backed resolution accepted by the owner. Do not explore or pursue other development goals during that period.

**A new task requires the owner's explicit permission.** This applies both to individual remediation tasks and to unrelated work. Approval of this plan is documentation authorization, not implementation authorization. Authorization for one task does not authorize other tasks or the rest of the backlog. Completion of the plan does not authorize further development automatically.

Within an explicitly authorized task, continue necessary inspection, implementation if authorized, and verification without requesting repeated approval for routine steps. Do not expand its scope. Record newly discovered issues as blocked candidates and seek explicit permission before taking them on. If a dependency blocks the current task, explain it.

Until implementation is explicitly authorized, work is review/documentation only. Do not modify application code, implement fixes, or open remediation pull requests.

## Engineering constraints

Priorities: reliability, correctness, least privilege, deterministic mechanical processing, minimal context/tools, maintainability, performance, KISS.

“Mechanical processes do mechanical things.” Keep identity, discovery, routing, validation, provenance, parsing, and bounds deterministic where practical. Foundry remains authoritative.

Prefer REMOVE > CONSOLIDATE > REUSE EXISTING CODE > SMALL FIX > NEW ABSTRACTION when reliability is comparable. Do not refactor for appearance or restore the feature/reference-index implementation wholesale.

Use the plan's finding IDs and closure criteria. Passing unit tests alone cannot close runtime or cross-component findings. Document verification limits honestly. Preserve historical branches.

The earlier [architecture checkpoint](docs/architecture-review-checkpoint-2026-09-27.md) is historical context. The stabilization plan governs current work.
