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
