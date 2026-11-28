# Moguri TUI

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)
![Platform: macOS arm64](https://img.shields.io/badge/platform-macOS%20arm64-lightgrey.svg)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

`@moguri-dev/tui` is the terminal UI and the `moguri` command-line interface of
[Moguri](https://github.com/moguri-dev), a model-agnostic AI harness for
engineering work. Both are clients of
[`@moguri-dev/sdk`](https://github.com/moguri-dev/moguri-sdk), which ships the
local control-plane service, the runtime and the workers. The
[Moguri desktop app](https://github.com/mbianchidev/moguri) bundles this
package and installs the `moguri` command.

> [!NOTE]
> This is an **alpha** for macOS on Apple silicon (Node.js 26). The package is
> published only to GitHub Packages; nothing is on npmjs yet.

## Install

The package lives on the GitHub Packages npm registry, which needs a classic
token with `read:packages` even for public packages. Map the scope and install
it globally:

```sh
npm config set @moguri-dev:registry https://npm.pkg.github.com
npm install -g @moguri-dev/tui@0.32.0-alpha.10
```

Put the token in your user `~/.npmrc` as
`//npm.pkg.github.com/:_authToken=...`, never in a committed file. The value
can be `${NODE_AUTH_TOKEN}` to read the token from that environment variable.
The `moguri` command runs on the current Node.js, which must be
`>=26.4.0 <27`.

## Use

```sh
moguri --help                                    # every command
moguri tui --project /absolute/path/to/project   # the terminal UI
moguri worker --stdio                            # on an SSH host: the SDK's remote worker bridge
```

In the TUI, `/connect` signs in, `/models` selects a model and `/help` lists
commands. The TUI, the CLI and the desktop app share one local service and the
same sessions. In a new profile, `/profile import SOURCE_ID` (or
`moguri profile import SOURCE_ID --profile NEW_ID`) reviews another profile's
model keys, endpoints, skill sources and repositories; repeating it with the
review digest and the chosen items copies only those. Sign-ins are never
copied. While the session disk is on, the status line shows its live usage. `moguri desktop` works only from a Moguri desktop source
checkout; otherwise open the installed app.

## Documentation

- [Development](docs/development.md) and [releasing](docs/releasing.md)
- [Terminal UI and themes](docs/architecture/themes-and-tui.md) and the
  [command launcher](docs/architecture/cli-launcher.md)
- [Third-party components](docs/third-party.md)
- [SDK reference](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/sdk.md)
- Product setup, settings and roadmap: the
  [desktop documentation](https://github.com/mbianchidev/moguri/blob/main/docs/README.md)

## Contributing, security and license

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[ACCESSIBILITY.md](ACCESSIBILITY.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Moguri's own code is MIT licensed
([LICENSE.md](LICENSE.md)); third-party code keeps its own licenses, listed in
[third-party components](docs/third-party.md).
