# Bundled macOS command launcher

The desktop distribution includes the CLI, TUI, OpenTUI dependencies and pinned
Node runtime, including for desktop-only users. Copying `Moguri.app` does not run
the TUI or install a shell command.

## Installation contract

**Settings > General > Command line > Install `moguri` command** is an explicit
native action. It installs one user-owned executable at `~/.local/bin/moguri`,
without administrator privileges or changes to shell startup files. PATH setup
is an explicit user command, not a claim inferred from Electron's environment.
Removal is a separate explicit action and leaves shell configuration alone.

The build ships an executable `dist/moguri` inside the app. Both the bundled
and installed launchers use the same shell body to `exec` the bundled Node and
`dist/cli.mjs`. They preserve arguments, working directory, standard streams,
signals and exit codes without depending on a system Node or starting Electron.
The bundled launcher resolves resources relative to itself. The installed
launcher binds the exact canonical app resources path selected at installation.

Installation publishes a completely written executable using an exclusive
hard link. It never truncates or replaces an existing file, directory or
symlink, including a dangling symlink or a manually created workaround.
Repeated installation of the unchanged managed command is read-only.
Removal requires the reviewed digest and exact recognized launcher bytes;
changed or foreign commands are retained.

Moving the app does not authorize a search for another installation. A broken
launcher exits nonzero with recovery instructions. Open the actual app at its
new location, remove the old managed command and install again. Removing the
app does not remove the command. The same recovery applies after reinstalling;
a manual workaround is never silently adopted.

## Boundaries and failure behavior

This reuses Node's filesystem/crypto APIs and Electron's isolated native bridge,
both MIT-licensed, plus the host's POSIX shell. No new library is introduced.
The operating-system installation is per macOS user, not per Moguri profile or
project. It is not an agent tool or an SDK/service capability: the renderer can
request only status, installation and digest-bound removal, never a path,
arbitrary contents or execution. Only the trusted main renderer may call it.

No domain events, persisted application preferences, protocol changes or store
migrations are needed. Status comes from the actual filesystem on each review.
Installation is unavailable in an unpackaged development client, a translocated
app or a copy under `/Volumes`. Hidden checks use generated homes and app bundles,
never the user's launcher or shell configuration.

Filesystem errors are surfaced, not treated as successful installation or
removal. An interrupted pre-publication write cannot expose a partial command.
An interrupted operation is not replayed on startup. A leftover private staging
file is not permission to overwrite or remove any command. Existing commands
remain independent of session cancellation, retention and service restarts.

## Packaged service entrypoint and ownership recovery

The protocol-88 failure was reproduced from merged `60197e5` using its actual
compiled CLI under a generated app layout and pinned Node 26.12.0. The installed
shell selected `dist/cli.mjs` correctly. That bundle had inlined the Node SDK,
whose `../service.mjs` was relative to `dist/sdk/node.mjs`, not to its new
`dist/cli.mjs` location. It consequently requested
`Contents/Resources/app/service.mjs` even though the shipped service was at
`Contents/Resources/app/dist/service.mjs`. The same inlining affected cold
generic CLI/TUI discovery. A separately built SDK consumer with an injected
`servicePath`, or a launcher check limited to `--help`, did not exercise it.

Client builds now retain a real relative import of `dist/sdk/node.mjs`. That
module owns all Node runtime/worker paths and keeps its service import lazy.
CLI, TUI and desktop do not relocate its `import.meta.url` by inlining it.
There is no filesystem search, development-checkout fallback, alternate app or
ambient Node selection.

A second, independent reproduction showed `service restart` failing at its
initial `lstat(connection.json)` after an unsuccessful launch or completed
shutdown. `restartMoguriService` now captures one state root, verifies its
selected service/runtime before interrupting anything, requests the existing
authenticated terminal-preserving shutdown, and waits for authenticated ready
health from the replacement. The unchanged 60-second readiness window is not a
fix for a missing file. Lifecycle acceptance, stopping and unconfirmed cleanup
are not readiness.

Absence is narrowly classified. With no captured owner, absent connection,
writer lock **and** recovery claim mean there is no registered service to stop;
normal exclusive startup may proceed. A captured owner additionally requires
its exact endpoint to refuse connections. A live or incomplete lock without a
registry may be initializing or have unconfirmed cleanup; it is not permission
to start or signal another process. A registered healthy owner is checked using
its private token, PID, protocol and root fingerprint, including again after
the asynchronous health read. Rotated/corrupt/private-file violations and lost
lifecycle acknowledgements retain explicit failure rather than a replacement.

Private metadata is read through bounded no-follow file handles and checked
against its actual inode after reading. Shutdown removes only its original
connection/lock bytes and identities. It can tolerate a missing connection
after its own resource cleanup, but never deletes a replacement registry.
Completed close stages are not repeated when later filesystem cleanup fails.
A private exclusive `service.lock.recovery` serializes dead-writer lock
reclamation; contenders recheck the original inode/bytes before unlinking it.
PID absence is only a stale-lock prerequisite, never ownership or permission
to signal. An interrupted or failed recovery claim remains unconfirmed and is
not deleted or replayed automatically.

This reuses Node filesystem/crypto/process APIs, esbuild, Electron and
`node-pty`, all MIT-licensed, with no added dependency or runtime boundary.
No domain event, durable schema marker, protocol bump or migration is needed:
protocol 88, original encrypted state, receipts, budgets and terminal identities
remain intact. The optional Node restart helper composes existing lifecycle
and health endpoints; it does not require a new service API. Worker, SSH bridge,
MCP worker and data-worker bytes are unchanged from `60197e5`; no older receipt
is used to qualify changed native bytes.

The regression executes the actual compiled CLI, generic CLI auto-start,
shell/bin launchers and **unmodified built service entrypoint** in a generated
installation. Only that private fixture's secret module is replaced with a
generated persistent backend; the user's keychain is never read. It checks cold
restart, already-stopped restart, drafts, held queues, independent artifacts,
retention-key identity and an actual macOS PTY across restart with no input
replay. The same fixture runs against the independently installed packed SDK
and actual app's distributed bytes. Separate generated lifecycle checks cover
missing/replaced registries, failed/lost acknowledgements, unconfirmed cleanup,
early process exit, retained recovery claims, eight concurrent stale-lock
clients, interrupted work and unknown charges.

Before this repair, the Phase 0 baseline was rerun on macOS arm64:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Generated provider requests/cancellation | PASS | Six requests; cancellation 30.41 ms |
| SQLite WAL/crash recovery | PASS | 1,000 events; append p95 0.066 ms; rebuild 0.597 ms |
| Generated PTY group cancellation | PASS | 152.48 ms; zero surviving children |
| OpenTUI React | PASS | 60 updates; mean 17.30 ms |
| Hidden Electron | PASS | Ready 196.75 ms; 445.64 MiB; scroll mean 8.22 ms |
| Generated filesystem/Git | PASS | 2,000 files; listing 0.84 ms; Git status 6.41 ms |

The baseline's unavailable live-provider, Rust/Linux, signing/notarization,
configured SSH, native SendBox and wider-roadmap gates still report FAIL. They
are not supplied or requalified by this service-recovery repair. Focused source
qualification passes 68 discovery/lifecycle/import/launcher/terminal checks in
15.54 seconds and nine hidden source Electron checks in 9.5 seconds, with one
actual-package-only case skipped. Final packed/app qualification is recorded
with its exact delivery artifacts, not inferred from those source results.

### Service recovery delivery qualification

The executable source cut is `603847d`, based directly on merged `60197e5`.
Protocol 88 and package version `0.31.0-alpha.1` are unchanged. Final notes do
not repack the following frozen development artifacts:

| Check | Result |
| --- | --- |
| Typecheck and production build | PASS |
| Root dependency audit | PASS; zero vulnerabilities |
| Independently installed packed SDK | PASS in 138.09 s; all four entrypoints/declarations, actual installed worker probes and zero consumer vulnerabilities |
| Installed cold-start regression | PASS; authenticated owner after 11,321 ms with original encrypted draft, without resetting or increasing the deadline |
| Exact installed CLI/service recovery regression | PASS; real compiled shell/bin/generic CLI paths, original service bytes, held input/artifacts/keys and same authenticated macOS PTY without input replay |
| Complete actual-package verifier | PASS in 60.17 s, including hidden Electron cold startup using copied actual app/SDK/service bytes and a fixture-only generated secret module |
| Untouched actual packaged Electron | PASS; nine launcher/shutdown/restart/terminal checks in 16.4 s, with one unpackaged-only skip |
| New distribution image build | PASS; no-cache pinned Linux arm64 build in 76.22 s; this is an image primitive, not VM/containment qualification |
| Actual ZIP/manifest through production update consumer | PASS; 814,520,052 bytes in 110.98 s; no app execution or quarantine bypass |
| Actual read-only DMG/layout | PASS; original signed app bytes, Applications shortcut, native icons and Finder geometry/background; Finder was not opened |

Artifacts are under `release/qualification-builds/service-recovery-603847d/`:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.31.0-alpha.1-macos-arm64.dmg` | 830012888 | `a5c690837c400520d90481099ad38a091804127fbd41ac6e090ec6685b335b1b` |
| `Moguri-0.31.0-alpha.1-macos-arm64.zip` | 814520052 | `bdeede47274328188b6919ef1562d816f26f6b684f99b041d1fbe02d6269e3c5` |

The matching integrity manifest is
`Moguri-0.31.0-alpha.1-macos-arm64.manifest.json`; the actual app is
`builds.noindex/0.31.0-alpha.1/Moguri-darwin-arm64/Moguri.app`.
These are ad-hoc-signed, **not notarized**, not published or installed over the
user's app. The DMG exceeds chat's attachment limit and remains a local artifact.

The new OCI image is
`docker.io/library/moguri-worker@sha256:5d94ab00004165579b95b06d8f2dcbb7e0119db2a3c96112b7313307a89e5742`.
Its 466,196,480-byte archive has SHA-512
`634808a07019079cf4921a0578f9e7dac16346fd571208043be1c31c3393684f15b34c1ec5620abba8af3d77c40a78ea56ae81af6b13d9daf55c5f286601237b`.
Unchanged worker payload hashes do not qualify a newly built image's native
runtime by inheritance. This repair does not claim a fresh physical SendBox VM
receipt, live inference, signing/notarization or wider milestone readiness.

Warnings remain: experimental OpenTUI FFI, renderer chunks above 500 kB and the
optional Apple `.icon` companion being unavailable while the normal `.icns`
exists. The actual-package probe logged `sandbox_setup`/`sandbox_release_feed`
diagnostics in generated state; that is not managed Sandbox readiness or proof
of the supplied personal log's `sandbox_setup_cancelled` provenance.

The separate main-only CI run
[41602139750](https://github.com/mbianchidev/moguri/actions/runs/41602139750),
on base `60197e5`, ended with **both jobs exceeding their 30-minute maximum
during tests**. Annotations also disclosed the Ubuntu-26 label migration and
macOS-arm64 capacity queues. It was not a successful full-source qualification;
no trigger, timeout or rerun was changed to conceal it.

## Qualification

Before feature implementation, `npm run spike` was rerun on macOS arm64 with
the bundled Node 26.12.0 and generated fixtures:

| Primitive | Result | Measurement |
| --- | --- | --- |
| Provider fixtures | PASS | Six intercepted HTTP requests; cancellation 30.69 ms |
| SQLite WAL/crash recovery | PASS | 1,000 events; append p95 0.077 ms; rebuild 0.504 ms |
| PTY group cancellation | PASS | 152.56 ms; zero surviving generated children |
| OpenTUI React | PASS | 60 updates; mean 17.31 ms |
| Hidden Electron shell | PASS | Ready 194.43 ms; 437.06 MiB; scroll mean 8.06 ms |
| Generated filesystem/Git | PASS | 2,000 files; listing 1.05 ms; Git status 6.15 ms |

The baseline script also reports its historical unavailable live-provider,
Rust/Linux, signing/notarization, SendBox, routing, decision-provider, configured
SSH and complete initial composer prerequisites as FAIL. These remain separate
from this launcher slice and do not revoke or extend later qualification.
Node's experimental OpenTUI FFI warning remains. No personal authorization or
live model call was made.

Launcher coverage executes both generated shell forms, including quoted
paths/arguments, exit status, process identity and signals; exercises collisions,
concurrent publication, stale removal, moved/missing/incomplete apps and hidden
native install/remove controls; and verifies the executable in the built package.

### Launcher delivery results

Measured 2026-10-25 on macOS arm64. No personal launcher, shell configuration,
authorization, microphone or live provider was used.

| Check | Result |
| --- | --- |
| Focused Node coverage | PASS: 11 launcher lifecycle checks and two application preference/migration checks in 2.38 s; 12 related compiled CLI checks also passed in the earlier 25-check run |
| Source hidden Electron | PASS: five launcher/application/settings-navigation checks in 7.7 s; the actual-package-only case was intentionally skipped |
| Actual packaged Electron | PASS: five checks in 8.2 s, including native installation of the real shipped CLI, execution with no system Node on PATH, and removal; the development-only case was intentionally skipped |
| Typecheck, build and shell syntax | PASS |
| Packed external SDK consumer | PASS, including browser-safe imports, actual installed runtime/worker/CLI and generated restart/ownership checks |
| Dependency audit | PASS: zero findings in the repository and external consumer |
| Development app, ZIP and DMG | PASS: executable launcher retained in the actual ad-hoc-signed app; no-cache pinned Linux worker image build completed in 35.01 s |
| Production update consumer | PASS: actual 740,609,730-byte ZIP/manifest verified in 106.55 s |
| Read-only DMG verification | PASS: actual signed app, Applications shortcut, native Finder geometry/icons and 1x/2x background verified without opening Finder |
| Broad `verify-package.mjs` | FAIL at an unchanged pre-existing browser-tool assertion: it expects only `fetch_page`, but the current builtin catalog also declares six browser tools. Its preceding signature, pinned Node, TUI, CLI and new executable-launcher checks passed. Unrelated browser behavior was not changed or disabled to bypass this assertion. |

Artifacts remain local development outputs, not a published or notarized
release. Their exact bytes are:

| Path under `release/` | Bytes | SHA-256 |
| --- | --- | --- |
| `Moguri-0.30.0-alpha.1-macos-arm64.dmg` | 754236391 | `9f8be1092d351952cd673dba496608db5900d9e3fa8cb412ee03056bc414fa46` |
| `Moguri-0.30.0-alpha.1-macos-arm64.zip` | 740609730 | `5b850b4369677db3619481a728b58be8dff67b2f0b80a48cb69645bc47f2b60f` |

Existing warnings remain: OpenTUI experimental FFI, Vite chunks above 500 kB,
the unavailable optional Apple `.icon` companion (the ordinary `.icns` is
present), and upstream `whatwg-encoding`/`node-domexception` deprecations.
The external consumer's Moguri postinstall required its existing explicit npm
script approval. None of these establishes notarization or broader release
readiness; the full package verifier failure above remains separate from the
qualified launcher and installer paths.
