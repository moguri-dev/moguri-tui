# Shared themes and terminal navigation

## Change contract

This user-requested slice extends the existing profile-owned appearance settings
and reworks the OpenTUI client. It does not add an agent backend, a global GitHub
inbox, a terminal emulator, model-control behavior or native execution authority.
OpenTUI core/React and React are reused under their MIT licenses. No dependencies
or franchise assets, characters, logos or copied interface text are added.

Ocean already provides the requested blue palette; Orchid remains its existing
violet palette. New presets cover pink, green-on-black terminal, aubergine, red,
monochrome, vaporwave and an original crystal-blue JRPG palette. Dark remains the
factory mode. Existing palette IDs, explicit modes and custom colors must survive
upgrade and restart unchanged. Desktop and TUI resolve the same SDK color tokens;
neither client owns a second theme preference store.

The terminal presentation uses restrained double-line menu frames, a crystal
cursor and a compact session-status panel. Content and actual pending decisions
take priority over decoration. Terminal fonts remain user-owned.
Single-row metadata and session labels use OpenTUI's own truncation, not a
Moguri text-width/VT implementation. At 52 by 24, the actual Env/model and
autonomy/budget rows remain readable. Pending approvals/questions reserve
space for their real human controls, with a one-row editable composer and one
inline slash suggestion; expanded arguments/choices still use the existing
focused views. Secondary plan/estimate detail stays available through `/progress`.
Chat and command-result scroll surfaces have distinct native identities so a
read result cannot inherit the chat's sticky bottom position or stale pixels.

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

### Independent schema lineage and integration gate

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
