# Development

This guide is for contributors working on the Moguri TUI and CLI. Coding
agents also follow [`AGENTS.md`](../AGENTS.md), which holds the repository's
binding rules.

## Toolchain

- macOS on Apple silicon runs the full suite and is the qualified platform.
  Linux runs a portable subset only; it is not release qualification.
- Node.js 26, pinned in [`.node-version`](../.node-version). `package.json`
  requires `>=26.4.0 <27`, and the committed [`.npmrc`](../.npmrc) enforces
  it with `engine-strict`.
- npm (bundled with Node). Dependencies are pinned exactly (`save-exact`).
- Git, and the GitHub CLI (`gh`) for releases.
- `rg` (ripgrep) on `PATH`: the SDK service's file tools run it, and several
  client tests reach them.

## Setup and running

The SDK, the local service and its workers come from the public
[`@moguri-dev/sdk`](https://github.com/moguri-dev/moguri-sdk) package on
GitHub Packages, which needs a token to install even public packages. The
committed `.npmrc` maps the `@moguri-dev` scope to
`https://npm.pkg.github.com`. Put a classic token with `read:packages` in your
user `~/.npmrc` as `//npm.pkg.github.com/:_authToken=...` before `npm ci`; the
value can be `${NODE_AUTH_TOKEN}` to read it from the environment. Never
commit it.

```sh
npm ci
npm run build
npm start -- --project /absolute/path/to/project   # the built TUI
npm run dev:tui                                    # the TUI from TypeScript sources, no build
npm run cli -- --help                              # the built CLI
```

`npm start` runs `dist/tui.mjs` on the pinned `node` runtime package from the
dev dependencies, and refuses until you build. `node scripts/launch.mjs service`
starts the installed SDK's local service the same way. The service keeps state
in `~/Library/Application Support/Moguri` unless `MOGURI_STATE_DIR` points to
a private directory; use a separate one for development.

The `moguri` launcher ([`bin/moguri.mjs`](../bin/moguri.mjs)) uses the pinned
`node` runtime package when it is installed beside it, as in the Moguri
desktop app, and otherwise the current Node. `moguri worker --stdio` runs the
SDK's remote bridge for SSH hosts. `moguri desktop` works only from a Moguri
desktop source checkout, where it finds the desktop package above the
installed package, and refuses otherwise. Embedders such as the desktop app
import `@moguri-dev/tui/cli` (`dist/cli.mjs`) and call its `run(argv)`, which
runs one command with the CLI's error reporting.

## Code layout

| Path | Contents |
| --- | --- |
| `apps/cli` | The `moguri` CLI, bundled to `dist/cli.mjs` |
| `apps/tui` | The OpenTUI + React terminal UI, bundled to `dist/tui.mjs` |
| `bin` | `moguri.mjs`, the package's `moguri` command |
| `scripts` | `build.mjs` (bundles and notices), `launch.mjs` (`npm start`), `verify-package.mjs` and `third-party-notices.mjs` |
| `tests` | Node test runner suites and shared helpers (`fixture.ts`) |
| `tests/fixtures` | Helpers that generate services, repositories, documents and API fixtures for the suites |
| `docs` | Development, release, third-party and architecture notes |

The build keeps every dependency external, so `dist` holds only this
repository's code and the SDK stays a normal installed dependency.

## SDK entrypoints

Product code in `apps/cli` and `apps/tui` imports only the supported
`@moguri-dev/sdk` entrypoints. `tests/client-sdk-boundary.test.ts` enforces
this.

| Export | Contents |
| --- | --- |
| `@moguri-dev/sdk` | Browser-safe typed client, protocol schemas and helpers |
| `@moguri-dev/sdk/node` | Service discovery, startup and the in-process runtime |
| `@moguri-dev/sdk/react` | React bindings |
| `@moguri-dev/sdk/mcp` | The gateway MCP server |
| `@moguri-dev/sdk/remote-bridge` | The SSH worker bridge behind `moguri worker --stdio` |
| `@moguri-dev/sdk/testing` | Unstable test support. Tests may use it; product code never does |

To change the SDK, the protocol or the service, work in
[moguri-sdk](https://github.com/moguri-dev/moguri-sdk), release a new version,
then bump the exact pin here. The
[SDK reference](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/sdk.md)
documents every API.

## Checks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript for the CLI and tests, then the TUI |
| `npm run build` | `dist/cli.mjs`, `dist/tui.mjs` and `dist/THIRD_PARTY_NOTICES.md` |
| `npm test` | Full Node suite, including the native TUI interaction test. Run `npm run build` first: some tests execute the `dist` bundles |
| `node --import tsx --test tests/<name>.test.ts` | One or more focused suites |
| `npm run verify:package` | Packs the package, installs it in a generated consumer and checks the CLI, the TUI, the `moguri desktop` refusal and the remote bridge |
| `npm audit --audit-level=moderate` | Dependency audit |

Tests use generated fixtures only: no real credentials, personal data,
microphones or live provider logins. Node prints an experimental FFI warning
for OpenTUI; it is expected.

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs only on pushes to `main`, on
macOS and Ubuntu: it installs ripgrep, then runs `npm ci`, the audit,
typecheck, build, `npm test` and `verify:package`. It reads the public SDK
package with the workflow's own `GITHUB_TOKEN`. It does not run on pull
requests or feature branches, so run the relevant checks locally before
opening a PR. The tag-triggered
[`release.yml`](../.github/workflows/release.yml) publishes releases; see
[releasing](releasing.md).

## Related repositories

- [moguri-sdk](https://github.com/moguri-dev/moguri-sdk) owns the SDK,
  protocol, local service, runtime and workers. Its
  [decisions](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/architecture/decisions.md)
  are authoritative for the shared stack.
- The [Moguri desktop app](https://github.com/mbianchidev/moguri) (moving
  later to `moguri-dev/moguri-desktop`) bundles this package to ship the CLI
  and TUI, and installs the `moguri` command. It holds the product-wide
  specification, setup, settings and roadmap.

## Documentation

Put durable documentation under `docs/` and update the relevant page in the
same change. Keep the [README](../README.md) short and link here instead.
