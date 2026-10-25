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
app or a mounted installer. Hidden checks use generated homes and app bundles,
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

Launcher coverage must execute both generated shell forms, including quoted
paths/arguments, exit status, process identity and signals; exercise collisions,
concurrent publication, stale removal, moved/missing/incomplete apps and hidden
native install/remove controls; and verify the executable in the built package.
