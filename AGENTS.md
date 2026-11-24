# Repository State

- This repository is `moguri-dev/moguri-tui`: the `@moguri-dev/tui` package with the `moguri` CLI (`apps/cli`), the OpenTUI + React terminal UI (`apps/tui`), the `bin/moguri.mjs` launcher, and their tests and generated fixtures. It was extracted with history from `mbianchidev/moguri` by mbianchidev/moguri#93 (D75 in moguri-sdk's `docs/architecture/decisions.md`). It is a macOS development alpha published to GitHub Packages, not a signed, notarized release. Never describe the wider roadmap as implemented.
- The SDK, protocol, local control-plane service, runtime and workers live in `moguri-dev/moguri-sdk` and arrive here as the exact-pinned public `@moguri-dev/sdk` package from GitHub Packages. Change SDK code there, release it, then bump the exact pin here.
- The desktop app (`mbianchidev/moguri`, later `moguri-dev/moguri-desktop`) bundles this package to ship the CLI and TUI, and installs the `moguri` command. Product-wide specification, setup, roadmap and the full architecture constraints live there; follow its [AGENTS.md](https://github.com/mbianchidev/moguri/blob/main/AGENTS.md) for anything this file does not cover. `docs/architecture/decisions.md` in moguri-sdk is authoritative for the shared stack.
- Moguri is built from zero with borrowed libraries; it does not fork OpenCode or Pi. This repository uses Node.js 26, OpenTUI + React and the SDK.
- `npm ci` needs a classic `read:packages` token in the user `~/.npmrc` (or `NODE_AUTH_TOKEN` in CI); never commit it.

# Client Constraints

- Work in the documented phase order and implement the smallest complete vertical slice across the local service, TUI and desktop; do not pull items from "Later work"/"Deferred work" ahead of first-release acceptance checks.
- The local control plane is authoritative. The TUI, CLI and desktop share one typed API, domain model and event stream; never keep client-only state or provider payloads.
- Add capability APIs in `@moguri-dev/sdk` (moguri-sdk). Product code imports only its supported entrypoints (`@moguri-dev/sdk`, `/node`, `/react`, `/mcp`, `/remote-bridge`), enforced by `tests/client-sdk-boundary.test.ts`. Only tests may use the unstable `@moguri-dev/sdk/testing` entry.
- Themes follow `docs/architecture/themes-and-tui.md`. Dark is the factory mode. The TUI and desktop resolve the same SDK color tokens; never add a second theme preference store.
- Optional repository indexing, context injection, subagents and evolution start off. Scripts/plugins cannot grant permissions or self-approve.
- Use OpenTUI's own rendering and truncation; never implement a new VT parser/renderer or persist terminal input/output in command receipts or model context.
- Cmd/Ctrl+Enter holds prompts without starting a turn; by default a completed turn then starts the top user-held prompt (D53). Held text, including `/yolo`, stays inert. Read-only/side modes are service-enforced.
- The composer exposes Env, Model, Autonomy level, and Budget. Factory defaults are Local, no selected model until provider login or local-model configuration, Manual, and Unlimited. Defaults can be overridden globally, per profile, per repo/project, and explicitly per session without weakening policy.
- Env offers Local (host execution), Sandbox (native SendBox), and Remote host (stored as `Remote`; agent execution and model calls on a user-configured SSH machine). SSH is not itself SendBox process isolation; show the actual boundary and never silently fall back to Local.
- Fixed-model or `kupo` selection, env, and autonomy level are independent. Manual is default; Guided requires human confirmation. Autonomous/Autopilot selection delegates automatic tool approvals, never hard-policy overrides.
- Router, critic, and decision-model output is untrusted advice until validated and authorized. Never label a model decision as a user answer, infer answers from queued text, heuristic badges or model confidence, or convert answers or attention read acknowledgements into approvals or permissions.
- Keep estimated, provider-reported, and billed costs in distinct fields. Unknown telemetry is not zero usage. Never invent exact token/cost telemetry or silently truncate history.
- Cancellation preserves requested, acknowledged, completed, failed, and partial outcomes. Never show stopped or partially cancelled work as successful.
- Profile scope is immutable per SDK/store/controller view; `--profile` never changes another client. Switching never moves drafts, credentials or running work.
- Push, merge, rebase, branch deletion, scheduled work, and self-modification require explicit user action or policy.
- Never open an app/browser or complete personal authorization on the user's behalf.

# Change Contract

- Before a feature change, identify reused libraries and their licenses, the SDK APIs and events it needs, cross-client behavior, failure/cancellation behavior, and the tests that prove it.
- A change that needs a new service API, event or durable schema starts in moguri-sdk, which bumps `PROTOCOL_VERSION`; this repository then bumps its exact `@moguri-dev/sdk` pin.
- Test concurrency, cancellation failure and restart recovery where relevant, not only happy paths; use generated fixtures without personal or customer data. Tests never use a real microphone or personal credentials.
- Put durable documentation under `docs/` and update the relevant document in the same change. Keep `README.md` a short landing page. Write plain, concise English without em dashes.
- Setup: `npm ci`. Build: `npm run build`. Type checks: `npm run typecheck`. Full local checks: `npm test` after `npm run build` (some tests run the `dist` bundles). Packed-package check: `npm run verify:package`. Audit: `npm audit --audit-level=moderate`.
- Wrap per-test timeouts and local polling deadlines (`Date.now() + ms`, attempt counts) in `ciTime()` from `tests/fixtures/time-scale.ts`. CI sets `MOGURI_TEST_TIME_SCALE` to stretch harness deadlines on slower runners; never scale product latency budgets or add blanket retries.
- Focused checks use `node --import tsx --test tests/<name>.test.ts`; combine related selectors in one invocation. `npm test` includes the native TUI interaction test (`tests/tui-exit-process.test.ts`) and the TUI milestone combination tests.
- `npm start -- --project /absolute/path` starts the built TUI, `npm run dev:tui` runs it from sources and `npm run cli -- --help` runs the built CLI.
- `npm run build` must keep emitting `dist/THIRD_PARTY_NOTICES.md`; MIT covers only Moguri's own code (`docs/third-party.md`).
- CI runs only for pushes to `main`. Do not trigger it on pull requests or working branches; run required verification locally.
- Releases follow `docs/releasing.md`: tag `v<version>` and let `.github/workflows/release.yml` publish to GitHub Packages and create the GitHub release. Publish only to GitHub Packages (`publishConfig.registry`).
- Never commit tokens or other secrets. The committed `.npmrc` holds only npm settings and the `@moguri-dev` scope mapping.
- Node emits an experimental FFI warning for OpenTUI. Linux CI checks a portable subset and skips macOS-only agent execution; it is not proof of Linux release readiness.
- Developer setup, layout and checks: `docs/development.md`. Contributor policy: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `ACCESSIBILITY.md`.

# Issue Tracking

- Product-wide roadmap and split tracking live in the desktop repository (mbianchidev/moguri#93, canonical record `docs/remaining-milestone-gaps.md` there). Before starting, delivering or closing issue work, `git fetch` and recheck the issue against current main, merged PRs and the decisions.
- Close an issue only when its acceptance criteria are met on main, or the remaining scope is an owner-signed exclusion recorded as a decision. A PR that delivers only a slice says "part of #N", not "Closes #N".
