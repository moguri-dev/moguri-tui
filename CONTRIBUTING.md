# Contributing to the Moguri TUI

Thanks for helping build Moguri. Bug reports, documentation fixes, tests and
code are all welcome. This guide explains how to propose a change and get it
merged.

## Before you start

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md) in every project space.
- **Security issues:** do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).
- **AI-assisted contributions:** you are responsible for everything you
  contribute, including AI-assisted code, documentation and assets. Review and
  test your contribution. You must be able to explain what the code does and
  why it is needed. See the
  [AI policy](https://github.com/mbianchidev/moguri#ai-policy).
- **Coding agents:** read [AGENTS.md](AGENTS.md) before editing anything. It
  holds the repository's binding rules and verified commands.

## Issues and proposals

- Search [existing issues](https://github.com/moguri-dev/moguri-tui/issues)
  first. Product-wide planning lives in the
  [Moguri desktop repository](https://github.com/mbianchidev/moguri/issues),
  and SDK or service bugs belong in
  [moguri-sdk](https://github.com/moguri-dev/moguri-sdk/issues).
- **Bugs:** include the `@moguri-dev/tui` version, your macOS version, the
  client (TUI or CLI), your terminal emulator, the environment (Local, Sandbox
  or Remote), what you expected, and the smallest steps that reproduce it. Use
  generated data; never paste credentials, tokens or private repository
  content.
- **Features and larger changes:** open an issue describing the problem and
  your proposed approach before writing a large patch. Moguri works in a
  documented phase order, so some ideas wait for earlier milestones.

## Development setup

You need macOS on Apple silicon for the full suite, Node.js 26 from
[`.node-version`](.node-version), and `rg` (ripgrep) on `PATH`.

The SDK comes from the GitHub Packages npm registry, which needs a token even
for public packages. The committed `.npmrc` maps the `@moguri-dev` scope; put
a classic token with `read:packages` in your user `~/.npmrc`
(`//npm.pkg.github.com/:_authToken=...`) before installing. Never commit it.

```sh
npm ci
npm run build
npm start -- --project /absolute/path/to/project   # the built TUI
```

The [development guide](docs/development.md) covers the code layout and every
check. [Releasing](docs/releasing.md) covers the release process, which only
maintainers run.

## Making a change

1. Create a branch from `main` and keep the change focused on one problem.
2. The TUI, CLI and desktop share one SDK and must not keep client-only state.
   The SDK, protocol and local service live in
   [moguri-sdk](https://github.com/moguri-dev/moguri-sdk): change them there,
   release a new `@moguri-dev/sdk` version, then bump the exact pin here.
   Product code imports only the supported SDK entrypoints listed in the
   [development guide](docs/development.md#sdk-entrypoints).
3. Add or update tests that would fail without your change. Use generated
   fixtures only: no real credentials, customer data or personal data.
4. Update the relevant documentation under `docs/` in the same change. Keep
   the README short.
5. Run the checks locally. CI runs only after merging to `main`, not on pull
   requests:

   ```sh
   npm run typecheck
   npm run build
   node --import tsx --test tests/<affected>.test.ts   # focused suites first
   npm test                                            # full suite, after the build
   npm run verify:package                              # packed-package check
   npm audit --audit-level=moderate
   ```

6. Write commit messages as short imperative sentences that say what changed,
   for example `Add retry backoff to model recovery`.

## Pull requests

- Describe what changed and why, link the issue, and list the checks you ran
  with their results.
- Call out SDK pin changes and the protocol version they need, new
  dependencies and their licenses
  ([third-party components](docs/third-party.md)), and any accessibility
  impact ([ACCESSIBILITY.md](ACCESSIBILITY.md)).
- A maintainer reviews every pull request. Address feedback with new commits,
  and reply to each review thread so reviewers can follow the discussion.

By contributing, you agree that your contribution is licensed under the
project's [MIT License](LICENSE.md).
