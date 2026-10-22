# moguri

A harness for your AI that works on your terms, both in a CLI (TUI) format and a desktop app

Moguri is built from zero with borrowed libraries. The [implementation specification](docs/implementation.md) defines the product and delivery order; [architecture decisions](docs/architecture/decisions.md) records the chosen stack.

## Initial implementation

The first executable checkpoint includes an **OpenTUI terminal client** and an
**Electron desktop app** sharing one local service. It supports GitHub Copilot
device sign-in, account-enabled model selection, streamed conversations, manual
approval of project file and shell tools, persistent drafts and queues, distinct
Queue/Steer/Interrupt delivery, stopping owned process groups, restart recovery,
archival/restoration, and basic per-call accounting.

The **importable Moguri SDK** now powers the CLI, TUI and desktop. It exposes
shared editable/restorable system instructions and permissions, opt-in local
vector/graph and coding-style memory, standard skills, reviewed evolution
proposals, curated/approved scripts, declarative plugins, optional tool-less
subagents and one native MCP gateway. Desktop starts dark and uses the same
original face-and-bat-wing mascot as the TUI's ASCII loading mark.
The mascot now also carries its small red antenna pom-pom.

The [task completion bar](docs/architecture/task-progress.md) periodically
checks the bound plan's Markdown checklist. Long tasks can also show an
owning-model estimate, separately labeled as advice, never proof of completion.

The owner-requested [protocol-41 platform extension](docs/architecture/platform-workflows.md)
adds **Sky/Terra/Glacier knowledge**, reviewed lifecycle hooks and immutable
repository-backed marketplace bundles. Imports/updates/rollbacks stay disabled;
knowledge injection has a separate default-off consent. Nothing self-approves
or starts a model merely because it was installed.

**GitHub workflows** expose exact-root reviewed main/force-with-lease pushes,
rebases, tags, two-way issue/PR/review work, pinned CI watching, releases and
exact-head PR merges. **Linear workflows** add team-scoped issue/project/comment
operations and explicit conflict-checked ticket pull/push. Both retain original
intent/results without replaying ambiguous writes. Dependency caching extends
to explicit private npm registries, npm/pnpm workspaces, Python, Rust/Cargo and
Go; mutable installs remain private and executable builds are not implied.
Desktop exposes the same APIs under Settings; shared `/github`, `/linear`,
`/knowledge`, `/hooks`, `/marketplace` and `/cache` commands reach TUI/CLI.

Whole-descendant containment can be required explicitly through **Guardrails /
Require qualified SendBox** or `moguri containment require-sandbox
--confirm-review`. Ordinary Local/SSH still owns known groups only. Missing
qualification blocks new work; selecting this policy does not silently change
an existing session's Env, qualify an old workload or choose a model.

Explicitly configured **local OpenAI-compatible models** now share the same
worker, permissions and accounting as Copilot. Endpoint discovery never scans
hosts or downloads weights. New sessions resolve snapshotted global,
current-profile and project controls, with explicit session overrides and
visible provenance; existing sessions are not rewritten.

Isolated **profiles** use immutable SDK clients over the same local authority.
Desktop's profile selector, TUI **F8** and CLI `--profile ID` preserve separate
accounts, projects, drafts, memory and artifacts. Creating a profile neither
copies data nor selects it. Global environment policy, shared startup
preferences and optional global hard budgets cannot be escaped by switching.
Old owned work stays in its original profile.
Remote writers sharing a pinned peer and canonical workspace serialize across
profile/target aliases and Local mappings; failed-root quarantine survives restart.
Guided questions can include an explicitly labeled current-solver recommendation
without another model call. You still choose the actual answer or tool approval;
advice retains its model provenance and cannot grant permissions.

Context supports project/client text, locally normalized clipboard/file
images, exact reviewed folders, typed GitHub issue/PR references and authorized
session-text snapshots. Unsupported image models preserve the draft/queue
rather than dropping context. Bare attachment prefixes remain literal until
the user selects their source.

Current source work for [#17](https://github.com/mbianchidev/moguri/issues/17)
offers the model maximum and half maximum, or actual provider-declared working
windows, through the same service contract. Unsupported saved values block
inference without clamping history. Pastes over 50 lines become exact scoped
text files, not whole-paste prompt expansions. Desktop, TUI and the SDK preserve
failed/conflicting unsent pastes; approved bounded file reads work through Local
and pinned SSH workers without modifying a source checkout. See
[usage](docs/setup.md) and the [context boundary](docs/architecture/context-inputs.md).
This does not complete the remaining compound, wind-down, Max or Sandbox gates.

Core **Remote SSH** execution uses an explicitly pinned host and approved
remote workspace. The existing worker runs inference and file/command tools
there; the local service still owns approvals and history. Disconnect/restart
reconciliation retains late accounting without replaying effects or turning
partial work into success. Files, Git changes and read-only plan views now use
the actual SSH workspace through the same SDK and slash commands.
The local service never substitutes an attached Local checkout for a Remote
workspace or index. Explicit Remote plan saves now bind the
reviewed peer/root/path/digest and run one owned filesystem operation without a
model, preserving independent Remote-boundary snapshots. Stops, lost receipts,
changed scopes and recovery keep partial outcomes honest and never replay writes.
Qualified 0.18.0-alpha.2 adds reviewed peer/resource Remote MCP grants, actual
model/external SSH calls and no-replay retained-result recovery, with shared
CLI/TUI and desktop review/inspection. Forwarding access is separately opt-in;
refresh credentials never leave their backend. This is still an initial
macOS alpha, not the completed first milestone.
Qualified **0.19.0-alpha.1 / protocol 25** also adds explicit Remote user consoles
with captured SSH host/root, original-owner restart recovery and ephemeral
Ghostty/CLI/TUI input. The exact SDK and macOS app are independently qualified;
[setup](docs/setup.md#preserved-qualified-0190-alpha1-checkpoint) records their
immutable identities. No terminal is silently relabeled Local or Sandbox.
Qualified **0.20.0-alpha.1 / protocol 26** also adds reviewed private repository metadata
through the selected SSH host's GitHub CLI account, with retained peer/root/
build provenance, no provider request and no laptop-account fallback.
Its exact installed SDK and actual packaged app are independently qualified;
[setup](docs/setup.md#preserved-qualified-0200-alpha1-checkpoint) records the
immutable identities. At that checkpoint, Remote repository memory remained
unavailable. Qualified **0.21.0-alpha.1 / protocol 27** now adds
session-bound Local/SSH lexical indexing, actual-host freshness checks,
optional model context/direct search and reviewed builtin memory MCP tools.
SDK, CLI, native TUI and desktop share exact peer/root identity and no-replay
index jobs. The exact installed SDK and actual packaged app are independently
qualified; [setup](docs/setup.md#preserved-qualified-0210-alpha1-checkpoint)
records their immutable identities. Old two-tool builtin MCP grants require
fresh review, never silent widening. Earlier archives remain unchanged.
Qualified **0.22.0-alpha.1 / protocol 29** adds a shared Local candidate workflow: explicitly
stage text proposals in a separate clean owned worktree, review again, then
apply only exact base-bound bytes. SDK, CLI, native TUI and desktop preserve
independent history, real user acceptance, raw index/HEAD and partial/restart
outcomes without a model or automatic commit. The exact installed SDK and
actual packaged app are independently qualified;
[setup](docs/setup.md#current-qualified-0220-alpha1-checkpoint) records their
immutable identities. Compound model routing,
finite kupo wind-down and Max still remain unavailable, not implied by the
private Cascade/Critique transport proofs.
Qualified **0.23.0-alpha.1 / protocol 31** adds independently retained planned
budget capacity and one explicitly cost-reviewed, tool-less Local model
proposal through the same SDK/CLI/TUI/desktop. Generated source/provenance and
actual charges remain inspectable; staging and application still need their
two separate reviews. Its exact installed SDK and actual packaged app pass
independent qualification; [setup](docs/setup.md#current-qualified-0230-alpha1-checkpoint)
records immutable identities. This is not completed compound routing or the
first milestone; see [the generation contract](docs/architecture/candidate-generations.md).
The **0.24 source foundation** adds internal complete planned-capacity batch
calculation, not another public model workflow or new native delivery.
Recorded and prospective roles share the same cumulative budget; a failed
whole bound leaves no prefix. The qualified 0.23 archives stay frozen.
Its private acknowledged-role probe reuses the actual worker and budget
transactions, not another model loop. Public compound admission and real-model
quality remain gated.
Qualified **0.25.0-alpha.1 / protocol 32** adds independently retained exact
role observations and shared read-only inspection through source deletion/
restart. Model data is not a user answer, code approval or normal solver
context. Its exact installed SDK and actual packaged app are independently
qualified; [setup](docs/setup.md#current-qualified-0250-alpha1-checkpoint)
records immutable identities. This includes the 0.24 prerequisites, not public
compound scheduling, real-family quality or finite kupo. Earlier archives stay
unchanged.
The **0.26 source** connects those complete retained role envelopes to the
actual control-plane worker, with conservative future contexts and no-replay
ownership. This remains an internal Node primitive, not public compound
scheduling or a new qualified native delivery.
Qualified **0.27.0-alpha.1 / protocol 33** links a final retained proposer to its
canonical candidate origin through shared SDK/CLI/TUI/desktop inspection and
separate staging/application. Its independent copy retains raw model evidence,
not quality or user acceptance. [Setup](docs/setup.md#development-027-canonical-final-role-proposals)
records complete source, independently installed SDK and exact native delivery
qualification and immutable identities. Earlier archives remain frozen.
Qualified **0.28.0-alpha.1 / protocol 34** adds explicit provider-declared Copilot
metadata inspection through the SDK, CLI, native TUI and existing desktop Model
menu. Normal login/discovery/inference is unchanged; unknown family stays
unknown, and declarations never attest independence, quality or approval.
[The contract](docs/architecture/model-evidence.md) and
[setup](docs/setup.md#development-028-explicit-model-declarations) separate its
source, exact installed SDK and actual native qualification from the frozen
0.27 delivery. Earlier archives remain unchanged.
Qualified **0.29.0-alpha.1 / protocol 35** adds explicit output/context contracts to the
existing internal owned executor and shared read-only contract inspection.
Router explanations cannot enter a contracted solver's selected context;
rejected or malformed advice stays charged and cannot start the next role.
This is not public compound scheduling, independent-family proof or acceptance.
[The contract](docs/architecture/owned-role-contracts.md) records complete
source, independently installed SDK and actual native qualification. The
qualified 0.28 artifacts remain frozen.

The first milestone remains incomplete. The
[remaining-gap handoff](docs/remaining-milestone-gaps.md) records its open
acceptance gates, model maximum/half-window choices, file-backed text pastes
over 50 lines and the user-requested SendBox 0.2.3 integration. Version bumps
do not establish completion or justify an increased estimate.

Current issue-17 source uses **protocol 37** for shared model windows, scoped
long-paste files and reviewed SendBox **0.2.3** execution. SDK, CLI/TUI and hidden
desktop run the same qualified private-stage worker, Manual decisions, budget
ledger, exact-owner stop/recovery and separate actual-user source publication.
Actual guest/control-loss checks retain partial work and unknown usage without
replay. [Setup](docs/setup.md#native-servicesdk-development-checkpoint) records
the generated provider evidence and remaining gates; this is not a replacement
for frozen archives, live-model quality or full first-milestone acceptance.

Chats can have **no project**, without inheriting any workspace root or coding
tools. `/suggestions` previews scoped prior prompts before model analysis;
`/meta` opens a settings chat whose changes require exact human review.
MCP HTTP servers support explicit **OAuth with PKCE**, resource-bound keychain
credentials and refresh. Shared question, approval and done indicators appear
in both clients. Desktop OS banners are off by default and use generic content
unless the user opts into previews.

The desktop composer is an icon toolbar: attach, environment, model name,
autonomy, unlimited-budget/usage, microphone and paper-plane Send. Holding
Cmd/Ctrl turns Send into a queue clock. Model context and supported thinking
effort are configured together through shared, durable SDK controls.

The session workspace adds **queue-only Cmd/Ctrl+Enter**, shared chat slash
commands, enforced read-only sessions and parallel question-only side chats.
Desktop embeds **Ghostty** through `ghostty-web`, alongside local diffs, plans,
isolated browser previews, linked PRs and Insights. Sessions support pin/group/
attach/unread/archive/delete actions; project settings and optional archived
retention share the same SDK. Deleting a session preserves independent project
artifacts and external PRs. A terminal is an explicit Local or pinned SSH
user console, not an agent permission or a claimed sandbox.
User consoles retain authenticated per-profile/peer owners across
explicit service restart or controller loss. Ghostty and shared SDK/CLI/TUI
inspection reattach the same process, never replay input or automatically
replace an old console. Ordinary service stop closes known groups; private
cleanup failures retain explicit retryable intent. Output stays bounded and
volatile, not conversation/model context. See the
[Local ownership](docs/architecture/terminal-reattachment.md) and
[Remote ownership](docs/architecture/remote-user-consoles.md) boundaries.

**Managed Local worktrees** isolate branch checkouts without moving the attached
base folder or index. Create, discover, inspect, open and safely remove them
through the shared SDK, CLI/TUI or project settings. Worker tools, Files,
Changes, Plan, terminals, memory and dependency installs resolve the same bound
root. Writers serialize within a root; different worktrees can run concurrently.
Removal requires a clean, idle, unbound owned checkout and preserves its branch.
Discovery does not adopt or grant access to unmanaged worktrees.

**Independent artifacts** retain plans, decisions, answers, research notes and
reports with revisions and actual source provenance. Create them without a
conversation, or explicitly retain a completed user/model/tool result. Each has
its own encrypted retention grant. Project removal previews the exact set and
requires retain, export-then-delete or delete; session retention never erases it.
Real structured clarifications record actual user answers and retain them by
default, with an explicit opt-out. Answers never grant tool/Git permissions.
Documents can associate with profile folders and project work items. Explicit
reviewed repository copies preserve complete history under `artifacts/`, with an
optional new local Git branch. No checkout, push or unrelated staging changes;
project deletion re-verifies the actual copy and any requested commit.

Dictation uses local NVIDIA Nemotron 3.5 through a pinned native runtime. The
user explicitly accepts and downloads the model once. NVIDIA documents
**40 locales: 19 ready, 13 broad coverage, 8 adaptation-only**, not 22 verified
ready languages. No cloud ASR fallback or automatic model-weight download occurs.

Projects also have a **local Kanban** for feature, bug and misc tickets, with
custom phases, connected PRs and read-only merge observation. A verified merge
moves a ticket to the chosen phase. Optional Linear imports start off, use a
user-supplied keychain credential and never upload local tickets.

The **shared dependency cache** reuses SHA-512-verified archives across projects
and branches, with npm and pnpm adapters. Exact lock/manifest plans and fresh
OSV advisory checks gate downloads and reuse. Managed installs block lifecycle
scripts and hooks, use private staging and keep mutable trees worktree-local.
This is not a malware-free guarantee; script execution stays unavailable until
a real SendBox boundary is qualified.

This is a **macOS development alpha**, not the completed first milestone.
Explicit **estimate-based token/USD caps** and separate profile/global hard
policies now share cumulative role-aware reservations. Unknown completion holds
capacity; deletion, defaults and restart do not refund it. USD needs dated
user-approved model rates, never a guessed Copilot price. These are admission
limits, not exact provider-billing guarantees. CLI/TUI, desktop composer,
settings and the profile usage dashboard share the SDK.
Dashboard views now add UTC presets/year/custom ranges, calendar buckets,
captured price history and retained per-call/owning-turn records. Observed
stream delivery metrics disclose missing coverage and are not GPU-throughput
or productivity claims; cache subsets never inflate reported totals.
Tool/MCP outcomes now have a sanitized, session-independent ledger with an
explicit known-result failure rate and separate denied/stopped/partial/unknown
counts. Dashboard, CLI/TUI and SDK also expose current-profile key-backed
ciphertext sizes, not physical disk usage or reclaimed space. Earlier deleted
tool history remains unavailable.
Repository/organization/visibility filters now use explicitly refreshed,
root-bound GitHub metadata and immutable per-admission snapshots. Every tagged
step rechecks its actual Local/SSH Git origin. Unknown history is not backfilled,
and the open-source category is explicitly public plus detected OSI-approved
license metadata, not a legal review or a synonym for public.

**Reviewed text-context compaction** now uses one explicitly authorized,
tool-less Local/SSH model call through the same SDK. Previewing does not infer;
generation, actual history/content review, apply/discard and original-context
restore are separate actions. Complete recent turns, original encrypted history
and drafts remain retained; rejected/unknown calls still count. Desktop exposes
review under Model, and CLI/TUI share `/compact`. Images, automatic compaction
and implicit kupo compactor selection are not supported.

[Experimental **kupo Single**](docs/architecture/routing.md) is opt-in with an
explicit approved classifier/solver pool and separate hosted/network-data consent.
The same owned worker records actual per-call roles/models and keeps normal
approvals. Desktop settings, TUI and shared slash/SDK controls expose the policy
and provenance. Invalid, stale or unmetered advice pauses without a fallback.
Finite inherited caps require the separately configured qualified Local
[reserved wind-down](docs/architecture/budget-winddown.md) policy. Without it
Single remains blocked rather than lifting the cap. Images and per-model
tuning remain unavailable on synthetic models.

[Reviewed **Local Cascade/Critique**](docs/architecture/compound-workflows.md)
now has a shared development service/SDK, CLI, actual TUI and desktop path.
An actual classifier binds a declared concrete route; tool-less proposals retain
the task plan, architecture and implementation. Actual-user review separately
authorizes staging and exact project tests in distinct owned worktrees.
Failed drafts remain isolated, and a recommended candidate still needs its
separate source-application review. Reviewed lineage sources are limited user
policy claims, not proof of independent training or calibrated quality.

Finite Local routing now reserves one actual metadata-only finishing role and
has separately reviewed actual-user accepted-work checkpoint branches that
preserve the source index/HEAD. A summary never accepts code or approves Git.
[Local **Autopilot Max**](docs/architecture/owned-decisions.md) now uses an
explicitly configured bounded-model System One-compatible alternative with
fixed or Single-routed solvers. Exact existing tool delegation, user-declared
technical choices and bounded safe-boundary steering share the real model
ledger and cancellation owner. The actual actor remains `decision-provider`,
not the user; human intervention and hard policy win. Jev itself remains
blocked where its documented API cannot enforce the required output bound.
No generative substitution or calibrated reliability is claimed.

The current generated source, packed SDK and exact native image pass the
[full acceptance sweep](docs/setup.md#final-protocol-40-source-acceptance).
Live-provider/calibrated-quality gates, complete remote/native
side-panel/extension transport, Remote/native compound/Max and
remote/native wind-down remain incomplete.
Unknown usage and Copilot billing are not presented as zero cost.
Manual remains the default. Guided still needs human confirmation; Autopilot
can use only explicit bounded user grants. SendBox has a visible fail-closed
configuration/readiness surface. The development 0.2.3 SDK/client lifecycle
now passes actual native generated-provider checks, but readiness still needs
explicit reviewed release/image/network pins and private staging. Endpoint-only
cold networking remains blocked; no alias or Local fallback is added
automatically. Installing SendBox alone does not enable native execution.

```bash
npm ci
npm run build
npm start -- --project /absolute/path/to/project
```

Run `npm run desktop` in another terminal to open the same sessions in desktop.
In the TUI, **Ctrl+L** starts Copilot sign-in, **Ctrl+M** selects a model, and
**Ctrl+K** shows commands. Desktop exposes the same setup in **GitHub Copilot**.
Complete GitHub's device authorization yourself; Moguri does not read IDE login
files or require another provider's API key.

See [setup and usage](docs/setup.md), the [SDK API and CLI](docs/sdk.md),
the [initial architecture](docs/architecture/overview.md),
and [Phase 0 evidence and remaining release blockers](docs/architecture/phase-zero.md).
The [session workspace contract](docs/architecture/session-workspace.md) records
Ghostty qualification, deletion/recovery and project-policy boundaries.
The [engagement contract](docs/architecture/engagement.md) records OAuth,
project-free isolation, suggestions, reviewed configuration and notifications.
The [runtime foundation](docs/architecture/runtime-foundation.md) records local
models/defaults and the genuine SendBox qualification blocker; [typed inputs](docs/architecture/context-inputs.md)
records snapshot consent and image/source boundaries.
The [managed workspace contract](docs/architecture/managed-workspaces.md)
records Local ownership, root consistency and partial-operation reconciliation.
`npm run package:mac` produces an ad-hoc-signed development app, DMG and ZIP under
`release/`. It is not a notarized distribution.
CI runs only on pushes to `main`, not pull requests or feature branches.

## macOS launch troubleshooting

Moguri provides ad-hoc-signed macOS alpha builds, not notarized production
releases. These steps apply only to a trusted `.app` whose source and
[integrity](docs/setup.md#current-qualified-0270-alpha1-checkpoint) you have
verified, if Gatekeeper blocks its first launch because of download quarantine.

Move that verified `.app` bundle into `/Applications` first. The qualified
bundle is named `Moguri.app`; if your separately verified build uses a different
name, substitute its actual bundle name:

```sh
xattr -dr com.apple.quarantine "/Applications/Moguri.app"
```

Then reopen the app yourself from Applications. This removes quarantine
recursively from this app only; it does not verify, sign or notarize it.
Never use this for untrusted downloads or to bypass malware warnings, and do
not disable Gatekeeper globally.

## Features

The feature inventory below captures the broader Moguri vision, not the list of
implemented features. The implementation specification distinguishes first-release
requirements from deferred work.

- Always choose either a fixed model or **kupo**, Moguri's HydraFusion-inspired synthetic/auto model. kupo routes across a configured mix of local and hosted models and selects single-model, cascade, or draft/critique/revision workflows.
- Optional System One decision providers, including [TypeSafe AI's Jev](https://docs.typesafe.ai/introduction), work with kupo and fixed models for delegated decisions, tool approvals, and steering.
- The chat composer, TUI, and CLI expose **Env**, **Model**, **Autonomy level**, and **Budget**. Starting defaults are Local, no model until provider login or local-model configuration, Manual, and Unlimited. Global, profile, and repo/project settings can supply different defaults.
- Desktop has an Attach button and image paste; shared attachment triggers are `^` for a local file, `:` for a local folder, `#` for a GitHub issue or PR, `!` for a Moguri session, and `@` for a project file. TUI/CLI expose equivalent typed attachments without the desktop button.
- **Env** offers **Local**, **Sandbox** via SendBox, and **Remote** via SSH. Remote runs the agent and model calls on the configured machine. Global policy may allow only Sandbox or Remote; it blocks new Local turns while existing Local turns may finish. Neither SSH nor a label implies SendBox containment.
- **Autonomy level** is independent of model choice and env: **Manual** (default), **Guided** (current model recommends; user confirms), **Autopilot** (current model acts within delegated policy and asks sparingly), and **Autopilot Max** (a decision model decides and steers within delegated policy). No level can bypass hard permissions, budgets, or allowed-env policy.
- **Budget** defaults to unlimited. Users can cap cumulative session tokens, USD, or both when telemetry supports it. The UI warns that caps may interrupt work; kupo tries to checkpoint and commit accepted changes before exhaustion when Git policy and approvals permit it.
- Dashboard (7,30,60,90,365 days, entire selectable year, custom period, all time)
  - Sessions cost
  - Token usage per session, divided by tool calls, MCP calls, system prompts, messages etc.
  - Compaction history
  - Velocity
  - Session metainfo (archived included) and easy delete for them
  - See pricing per session (depends on provider API)
  - Global aggregate dashboard with filters per: time (day, week, month, all time, custom), repo, github org, open source vs private, etc.
- Integration with local AI models ready to install from huggingface - previous system status check
- New productivity shortcuts
  - option/ctrl space for voice dictation with NVidia nemtron new model
- Profiles with (possibly) different API keys and projects binded to them, and different accents + policies
  - Work
  - Open Source
- When models ask question save user answers as artifacts tied to the session but not deleted when session is. The artifacts are tied to the project and when deleting a project with at least one artifact the agent asks if the user wants to commit the artifacts in an artifacts/ folder in the project itself. Examples of artifacts
  - Decisions (why did I use Golang instead of Rust?)
  - Plans
  - Answers to questions on the project
- Projects with worktrees
  - Work-tree aware sessions or from issue, or from PR (requires GitHub MCP, or Linear or Jira installed)
- Folders containing multiple repos/projects
  - Can work on multiple project as part of a stream, with coordinated PR merge capabilities - optionally integrated with Stacked PRs from GitHub
- Group sessions within the same projects with or without an orchestrator session
  - Allow to attach an orchestrator session later
- Command palette
- Split panel
- Desktop-only, main-session-aware [sidebar](docs/specs/desktop-sidebar.md) for Changes, Terminal, Files, Stainless Browser, Side chat, Insights, and Extensions
- Save draft prompts so if app closes nothing happens to that prompt, in the same way save queued ones for when a session resumes
- Session archive must be visible and explorable
- Delete session policy, default off, configurable in amount of days or max GB occupied
- Agent skills/hooks
  - Self evolving (optional) powered by actual memory with 3 tiers: glacier, terra, sky
  - Defined gallery/marketplace
- Metachat
  - Chat with moguri for changing its own settings and for trouble shooting
- Scheduled actions
  - Watch CI
  - Dependencies roundup see dependabot, renovate and other bot PRs
  - "My work", check open PRs
  - Run prompt
  - Run agentic workflow (prompt + specific scripts with nice syntax) - optional delegated to server
- Granularity of views compact vs detailed for agent tools, steers, etc.
  - Expose ALL thinking (collapsible)
  - Share time elapsed since script started
  - Share total time elapsed since sub-session/sub-agent started (and token count if possible)
  - Share total time elapsed since whole session started
  - Make sure commands run by the agent and subagents are stoppable at all times manually from GUI 
- Structured and exposed harness plugins/instructions/skills (with slash commands / when feasible - skills always)
  - github plugin for correctly opening/closing/editing PRs, issues - querying CI checks, checking Actions logs, dependabot PRs, code review comment read + write + resolve convo
  - vulnerability resolution methods
  - conflict resolution with rebase vs merge on main/master or other target PRs
  - logging / observability
  - commit message style, rules (linted) and frequency
  - commit message signing with secure SSH key and strip co-authored with to avoid doing free marketing for agents
  - token savings `--silent` & co. + caveman
  - documentation guidelines (in docs/ not in random markdown files)
  - tech stack preferences
  - general coding guidelines
  - etc. see [https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md](https://github.com/mbianchidev/.github-private/blob/main/copilot-instructions.md) for full list
- Self evolving tools
  - Python tools for diffing, parsing, splitting, finding are built in so the models do not generate those runtime wasting tokens
- Better messaging
  - Automatically detects prompts that are repeated e.g. "Fix all review comments and rebase on main" will get a proposed slash command `/fix-rebase`
  - Allow ordering/shuffling, deleting or editing messages previously queued (if not picked up already)
  - Allow sending a message in different modes:
    - Stop current turn and send immediately
    - Queue waiting for current turn to finish
    - Steer the current turn
- Better chat/sessions
  - Unarchive sessions (not the deleted ones, of course)
- New continous modes (with taggable @ agents)
  - Continous Product manager - implements PostHog in product -> gain insights on usage -> find metrics to improve and lack of features -> market research -> create issues -> create assumptions -> after implementation measures improvements and reports back to user
  - Continous Maintenance (toggle per repo) - keeps all dependabot update/security PRs merged taking care of breaking changes + other custom actions
  - Continous Docs (toggle per repo)
- New agent modes
  - Deep search - give a goal, run research, use sources and get to the bottom of a question (scientific oriented)
  - SRE - give an error, access to read-only infra MCPs, architecture diagrams and code -> get a resolution
  - Autopilot - give a clear task, agent works until the very end
  - Long running Autopilot - like the previous but for giant greenfield projects (e.g. a browser), complete rewrite of codebases (e.g. from C to Rust)
  - Stabilize - takes a repo, checks out the current status, tries to merge all the current pending PRs, fixes security issues, installs dependabot, enhances and hardens Actions, installs agentic workflows to triage issues
  - Swarm - Solves all open issues by creating a roadmap and rationalizing the end to end state of the repo, after planning carefully and reporting back to the user before implementation
  - Team (like [squad](https://bradygaster.github.io/squad)) + [paperclip](https://github.com/paperclipai/paperclip) style, council and other projects that use different personas + agents for better results
- Integration with:
  - [mbianchidev/sendbox](https://github.com/mbianchidev/sendbox) - native, first-release Sandbox env with scoped local VM execution; missing sandbox support never silently falls back to Local.
  - mbianchidev/porto - for handling local dev servers and docker stacks (via CLI pre-installed)
  - mbianchidev/sql not-so-lite - for local database management (via CLI pre-installed)
  - (future) mbianchidev/stainless - agentic privacy driven browser, used for dev previews and for launching Playwright (via MCP and open with)

## To evaluate

- Virtualised Work Trees: Utilizing B-trees and hash array map trees, Delta DB makes spinning up new "agent branches" nearly instantaneous and computationally "free" through copy-on-write persistent data structures.
- Conflict-Free Replicated Work Trees (CRDTs): Enables multiple humans and agents to manipulate the same codebase concurrently without traditional merge conflicts.
- Model Blame: Users can identify exactly which AI model or agent wrote a specific line of code, providing a historical record of the "agentic" logic.
