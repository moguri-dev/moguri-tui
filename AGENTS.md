# Repository State

- This repository is currently a documentation-only pre-alpha: it has no application source, manifests, lockfiles, tests, CI, or verified build/lint/test commands. Do not describe roadmap features as implemented or invent commands.
- `docs/implementation.md` is the canonical implementation specification. `README.md` retains the product feature inventory; `docs/architecture/decisions.md` is authoritative for the selected stack. Reconcile documentation with executable code/config once those exist.
- Moguri is built from zero with borrowed libraries; it does not fork OpenCode or Pi. `docs/architecture/decisions.md` records the chosen stack: a Node.js 26 service, an OpenTUI + React TUI, an Electron + React desktop app, a Moguri-owned agent loop on `pi-ai`, and Rust helpers for process control, PTYs, file search and Git reads. Change a decision only by updating that file.
- Before adding Moguri features, follow Phase 0: run the validation spikes listed in `docs/architecture/decisions.md` and record each pass or fail result with measurements under `docs/`.

# Implementation Constraints

- Work in the documented phase order and implement the smallest complete vertical slice across the local service, TUI, and desktop; do not pull items from "Later work"/"Deferred work" ahead of first-release acceptance checks.
- The local control plane is authoritative. TUI, desktop, and optional VSX clients must share one typed API, domain model, and event stream rather than owning client-only state or provider payloads.
- The composer exposes Env, Model, Autonomy level, and Budget. Factory defaults are Local, no selected model until provider login or local-model configuration, Manual, and Unlimited. Defaults can be overridden globally, per profile, per repo/project, and explicitly per session without weakening policy.
- Env offers Local (host execution), Sandbox (native SendBox), and Remote (agent execution and model calls on a user-configured SSH machine). Global user-only allowed-env policy can require Sandbox or Remote. New Local turns are then blocked, but already-running Local turns may finish. SSH is not itself SendBox process isolation; show the actual boundary and never silently fall back to Local.
- Fixed-model or `kupo` selection, env, and autonomy level are independent. `kupo` supports single, cascade, and critique/revision workflows across approved, available local and hosted models. Manual is the default; Guided recommends but requires human confirmation. Autopilot and System One-backed Autopilot Max act only within explicit user-delegated policy.
- Router, critic, and decision-model output is untrusted advice until validated and authorized. Record every call and its cost, decision provenance, and cancellation outcome; never label a model decision as a user answer or let confidence override policy.
- Durable state is a typed, append-only, versioned event stream. Durable schema changes require migrations and restart-recovery coverage; never make users delete local state to upgrade.
- Keep artifacts independent of session retention, profiles isolated, secrets in an explicit secret backend, and estimated, provider-reported, and billed costs in distinct fields.
- Session budgets default to unlimited tokens and spend, subject to stricter policy limits. Optional token/USD caps include every model role; unknown telemetry is not zero usage. kupo reserves wind-down budget and attempts an authorized checkpoint commit before exhaustion, without overriding approvals, exceeding the cap, or claiming a commit succeeded when it did not.
- Cancellation must propagate through owned work and preserve requested, acknowledged, completed, failed, and partial outcomes. Never record stopped or partially cancelled work as successful.
- Push, merge, rebase, branch deletion, scheduled work, and self-modification require explicit user action or policy.

# Change Contract

- Before a feature change, identify reused libraries and their licenses, new invariants/events, schema and migration impact, cross-client behavior, failure/cancellation behavior, and the tests that prove it.
- Test concurrency, cancellation failure, migrations, and restart recovery where relevant, not only happy paths; use generated fixtures without personal or customer data.
- Put durable architecture documentation under `docs/`. Update the relevant setup, configuration, architecture, or protocol document in the same change.
- Once an executable toolchain lands, update this file with exact setup and focused/full verification commands; none are currently verifiable.
