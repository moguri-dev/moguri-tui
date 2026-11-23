# Reused components and licenses

Moguri is original application code, not an OpenCode or Pi fork. Its own code,
including this package, is licensed under the [MIT License](../LICENSE.md).
Versions are pinned in `package.json` and `package-lock.json`; upstream
license and copyright notices remain in the installed dependencies.

## Licensing of the package

The MIT License covers Moguri's own source. It does not relicense any
dependency, bundled component or service Moguri connects to.

- `npm run build` writes `dist/THIRD_PARTY_NOTICES.md`, which reproduces the
  license files of every third-party package esbuild bundles into
  `dist/cli.mjs` and `dist/tui.mjs`, and lists any without an OSI-approved
  license first. The build keeps dependencies external, so the list is usually
  empty. Moguri's own `@moguri-dev` packages are covered by `LICENSE.md` and
  not listed.
- Dependencies install unbundled in `node_modules` and keep their own license
  files in place.
- [`@moguri-dev/sdk`](https://github.com/moguri-dev/moguri-sdk) ships its own
  `dist/THIRD_PARTY_NOTICES.md` for the service and workers it bundles. That
  includes the proprietary `@anthropic-ai/claude-agent-sdk`, which is excluded
  from Moguri's MIT License. The SDK's
  [third-party components](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/third-party.md)
  page explains its terms and every other SDK component.

## Dependencies

| Component | License | Use |
| --- | --- | --- |
| `@moguri-dev/sdk` | MIT, with its own third-party notices | Typed SDK, local service, runtime, workers and the SSH remote bridge |
| OpenTUI core and React renderer (`@opentui/core`, `@opentui/react`) | MIT | Native terminal rendering |
| React | MIT | UI components and state hooks |
| YAML (`yaml`) | ISC | YAML parsing in the CLI |

## Development dependencies

These are used to build and test the package and are not installed with it.

| Component | License | Use |
| --- | --- | --- |
| Node.js (`node` package) | MIT | Pinned runtime for `npm start`, and for the `moguri` launcher when present |
| esbuild, tsx | MIT | Bundling and running TypeScript in development and tests |
| TypeScript | Apache-2.0 | Static verification |
| `@types/node`, `@types/react` | MIT | Type definitions |
| `node-pty` | MIT | The native TUI interaction test |
| `@earendil-works/pi-ai` | MIT | Provider and credential-store helpers in test fixtures |
| `@resvg/resvg-js` | MPL-2.0 | Optional PNG screenshots of generated TUI frames in tests |
| `spdx-license-list` | CC0-1.0 | OSI license checks for the third-party notices |
