# Shared themes and terminal navigation

## Change contract

This user-requested slice extends the existing profile-owned appearance settings
and reworks the OpenTUI client. It does not add an agent backend, a global GitHub
inbox, a terminal emulator, model-control behavior or native execution authority.
OpenTUI core/React and React are reused under their MIT licenses. No dependencies
or franchise assets, characters, logos or copied interface text are added.

Ocean already provides the requested blue palette; Orchid remains its existing
violet palette. New presets cover pink, green-on-black terminal, aubergine, red,
monochrome, vaporwave and an original crystal-blue JRPG palette; D54 adds Amber
and moves every preset onto a neutral (untinted) base. Dark remains the
factory mode. Existing palette IDs, explicit modes and custom colors must survive
upgrade and restart unchanged. Desktop and TUI resolve the same SDK color tokens;
neither client owns a second theme preference store.

The current terminal presentation is
[compact and chat-first](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/architecture/sdk-platform.md#compact-chat-first-terminal), replacing
the historical double-line menu frames and loading splash. A single-row header
and navigation leave room for conversation; the growing composer's accent rail
is the main visual landmark. Content and actual pending decisions take priority
over decoration. Terminal fonts remain user-owned.
Single-row metadata and session labels use OpenTUI's own truncation, not a
Moguri text-width/VT implementation. At 52 by 24, the actual Env/model and
autonomy/budget rows remain readable. Pending approvals/questions reserve
space for their real human controls, with a one-row editable composer and one
inline slash suggestion; expanded arguments/choices still use the existing
focused views. Secondary plan/estimate detail stays available through `/progress`.
Chat and command-result scroll surfaces have distinct native identities so a
read result cannot inherit the chat's sticky bottom position or stale pixels.
Completed tool output folds only in the view. F2 or `/details` exposes retained
messages, including their full text; unconfirmed and unsuccessful outcomes are
never hidden as ordinary success. PgUp/PgDn pauses following, while F3 explicitly
returns to the latest output without changing or sending the draft.

Navigation uses real OpenTUI mouse hit testing for Current session, Sessions,
Work items and Code requests. Code requests means existing session-linked pull
requests and code-change review, not a new inbox. Navigation is read-only:
listing or switching views must not call a model, answer a question, approve a
tool, fetch GitHub metadata implicitly or consume a draft. Left/right arrows
close/open the sidebar only while navigation has focus; composer arrows retain
normal cursor editing. Slash commands are the primary discoverable actions.
Existing send/newline/hold, queue/steer/interrupt/stop and review semantics remain.

Only the existing settings event gains additional palette values. No existing
event, ciphertext, retention grant, receipt or user choice is rewritten. The
protocol version must change so an older running service is not reused for new
palette values. Upgrade/restart and failed-upgrade coverage must prove this.
Settings compare-and-swap failures remain explicit; they cannot replace another
client's settings or fall back to another palette. Navigation cannot escape a
local unsaved editor or a settling owned operation.

### Actual combined80 integration

Themes/TUI merged first as main `8eca0de`. The user then authorized a merge
of that actual baseline into the model/workspace branch, without rebasing,
stacking or merging its pull request. The genuinely combined implementation
uses the previously reserved protocol80, not a relabelled standalone79.
It preserves the merged presets, shared `/theme` SDK behavior and actual
JRPG-style OpenTUI navigation together with model continuity and workspace
interactions.

The combined schema requires `theme_catalog_schema='1'`,
`model_selection_continuity_schema='1'`, `queued_slash_schema='1'`,
`project_folder_actions_schema='1'`, `sandbox_multi_root_schema='1'` and the
distinct `theme_model_workspace_convergence_schema='1'`. Exact genuine76,
model77-only, theme78-only and workspace79-only predecessors are validated
against all retained profile histories before their missing features and
version80 commit atomically. A numeric version cannot manufacture a missing
marker. New palette history cannot become theme-less model/workspace history;
retained thinking intent cannot become theme78-only history. Unknown,
corrupt, prematurely marked or numerically downgraded combinations are rejected
without changing original retained bytes.

The historical standalone contract and qualification below remain evidence
for their original source only. Changed80 payloads need their own SDK, TUI,
desktop, native and packaging evidence. The actual merged TUI now uses shared
queued text intake and compatible client claims instead of its development
block. View/theme actions are not eager; actual rendered frames acknowledge
navigation while direct mouse/Tab/key navigation remains direct. The user selected
headless service execution for service-capable commands, while actual UI-only
actions wait for an acknowledged compatible client.
Held text, including `/yolo`, remains inert. Only unheld stop/approval/yolo
controls are live. Real user-gate scheduling, original continuation reviews,
retained responses and draft provenance follow
[the shared command contract](https://github.com/mbianchidev/moguri/blob/main/docs/architecture/workspace-experience.md#shared-queued-command-primitives).

### Historical independent schema lineage and integration gate

This branch uses protocol/schema **78** and `theme_catalog_schema='1'`. Genuine
baseline 76 has neither this marker nor
`model_selection_continuity_schema`. The migration advances 76 directly to 78,
adds only the theme marker and does not manufacture model-continuity provenance.
Missing/corrupt current markers, premature older markers and new palette history
relabelled as older data are rejected without rewriting retained bytes.

Protocol 77 and `model_selection_continuity_schema='1'` belong to a separate
in-progress model-controls workstream. This standalone build explicitly refuses
that lineage rather than attempting to read unknown fields or marking its
migration complete. Conversely, an older protocol-77 build must reject a newer
78 store. Human landing order is model-controls first, then themes, with actual
combined-source marker/history convergence and requalification before the second
PR becomes merge-ready. Neither branch may infer a completed feature migration
from the numeric version, lower 78 or borrow the other's native payload receipts.
This is a documented integration gate, not a dependency imported into this PR.
That workstream subsequently reserved protocol 79 for its command-intake,
folder-management and grouped-project Sandbox follow-up, and protocol 80 for
the eventual actual combined themes build. Neither reservation is implemented
or claimed qualified here. Genuine standalone 78 receipts remain 78 evidence;
actual combined 80 source, markers and payload identities require new evidence.
The known upcoming 79 markers are `queued_slash_schema='1'`,
`project_folder_actions_schema='1'` and `sandbox_multi_root_schema='1'`, alongside
the independent model-continuity marker. The proposed `sdk.commands.submit(...)`
intake and client registration/acknowledgement contract are not implemented or
approximated here. `sdk.slash(...)` remains the lower-level immediate dispatcher
for explicit direct SDK use, not proof of ordered chat submission.

The owner subsequently selected intentional queued slash-command execution in
the other workstream. Its actual shared intake/dispatch contract must also be
integrated before this PR becomes merge-ready. This branch does not invent a
second queue or enqueue raw slash text that baseline workers could interpret as
a model prompt. Idle Enter may execute a new view/theme/quit action with no
earlier work; held commands, active turns or an earlier queue instead preserve
the command draft and report the missing intake explicitly. Click/Tab view
navigation remains available. This fail-closed development boundary is not completed queued-slash
support. The user subsequently confirmed only live stop/approval controls and
`/yolo` as bypasses in the other workstream; navigation and theme changes are
not exempt. This branch neither adds `/yolo` nor invents that dispatch contract.

## Prerequisite measurements

Before feature integration, `npm run spike` and
`node scripts/platform-spikes.mjs` ran on macOS arm64 with the pinned Node 26.12
runtime. Missing dependencies were restored with `npm ci`; its audit reported
zero vulnerabilities.

| Generated prerequisite | Result |
| --- | --- |
| Intercepted provider discovery/streaming/cancellation | PASS; six requests, cancellation 31.33 ms |
| SQLite WAL/crash/rebuild, 1,000 events | PASS; append p95 3.17 ms, rebuild 0.83 ms |
| Owned nested PTY group | PASS; cancellation 152.03 ms, zero fixture survivors |
| OpenTUI streaming, 60 updates | PASS; average update 17.06 ms |
| Hidden Electron, 10,000 rows | PASS; cold start 220.42 ms, 447.02 MiB, scroll frame 8.16 ms |
| Bounded Node filesystem/Git baseline, 2,000 files | PASS; search 1.13 ms, status 7.73 ms |
| SQLite vector/graph, 500 rows | PASS; 6.06 ms |
| Official MCP discovery/call/result | PASS |

The generic historical spike still explicitly reports FAIL/unavailable for live
provider entitlement, Rust/Linux supervision, signed/notarized packaging, native
SendBox, live multi-model/decision quality, personal SSH and the original full
attachment/budget roadmap. These measurements do not qualify those capabilities
or claim evidence from another branch. OpenTUI's experimental FFI warning remains.

## Acceptance evidence

Qualification uses generated fixtures, the actual native OpenTUI renderer and
terminal mouse/key byte parsing, plus hidden Electron and an independently packed
SDK consumer. Required coverage includes every named palette in both modes,
text/control/selection/focus contrast, saved/custom theme compatibility,
cross-client updates, actual mouse tabs, focus-safe sidebar arrows, slash
completion and execution, resizing, retained drafts and untouched approvals.
No personal credentials, live inference or visible user application is used.

### Standalone qualification, 2026-10-29

Runtime source is `37ddfa8`; earlier `2640caa` previews and `4d298a1` development
receipts remain historical, not relabelled final evidence. Subsequent
documentation does not change runtime payloads.

| Gate | Result |
| --- | --- |
| Type checks and production build | PASS |
| Complete Node/worker/CLI/native-TUI suite | 1,814 passed, 14 declared physical-native skips, zero failures; 1,828 total / 1,529.77 s |
| Complete hidden Electron suite | 254 passed, three declared skips, zero failures; 257 total / 8.1 min |
| Focused predecessor migration, rollback, provenance and restart suite | 118 passed, zero skips or failures |
| Focused TUI interaction suite | 58 passed, one physical-native skip; includes the existing workflows and new navigation cases |
| Final navigation/focus/compact-decision cases | 11 passed, zero failures; actual native mouse/key parsing, no callback-only substitute |
| Packed external SDK types, browser-safe root/React, explicit Node/MCP, installed worker/CLI/TUI and audits | PASS; zero vulnerabilities |
| Root dependency audit | PASS; zero vulnerabilities |
| Generated pinned loopback SSH primitive on rebuilt worker/bridge | PASS; one generated inference request / 178.83 ms |
| Ten presets, two modes, 620 shared RGB pair checks | PASS; minimum normal text 4.587:1, control boundary 3.485:1, accent 4.820:1 |
| Actual native selected cells and hidden desktop controls | PASS across all presets and modes; saved custom colors, System event handling, reload and cross-client state remain intact |

The contrast matrix measures the declared shared RGB pairs, not whole-app WCAG
certification on arbitrary terminal palettes or physical displays. The native
UI previews are generated OpenTUI character/color frames rendered with a system
monospace font. They show actual tested views, not a personal terminal capture
or a replacement terminal renderer.

The 14 unit skips need qualified immutable physical SendBox receipts for these
exact payloads. The three desktop skips are the actual packaged CLI installation
and two physical-native Sandbox flows. The generated passes do not qualify those
boundaries, Linux, signed/notarized packaging or the later combined protocol 80.
OpenTUI's experimental FFI warning and the existing lazy Ghostty chunk-size
warning remain. CI is intentionally main-only; working branches do not trigger it.

### Exact protocol-78 payload identities

These are SHA-256 values of this branch's final rebuilt bytes, not receipts from
another workstream or a claim that an older native image contains them.

| Payload | SHA-256 |
| --- | --- |
| `dist/worker.mjs` | `4fd650f4fa4e09d0d83363133723327d35e55ecab1fa81fd8aa27921da932541` |
| `dist/remote-bridge.mjs` | `f67aaa589778c2b76c7c0b0f290b9ab83e48ffc7782ad4ba61a1078cc1b57409` |
| `dist/terminal-bridge.mjs` | `0cc11fbf82834c13a2c39f51364f965adff535fc382b55195397802420689948` |
| `dist/terminal-broker.mjs` | `c8588fc74de4bc590495653f475551de6fdc96667153a7893df463d3ff7557b2` |
| `dist/tui.mjs` | `3670114687506717b2aab8fe2622e668c61bfca250a106f3dc19818664dcd7b0` |
