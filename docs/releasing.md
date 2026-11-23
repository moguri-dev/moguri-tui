# Releasing the TUI

`@moguri-dev/tui` is published to the GitHub Packages npm registry
(`https://npm.pkg.github.com`) and as a GitHub release with the packed tarball
and its SHA-512. The package ships the `moguri` launcher, the built CLI and TUI
bundles, their third-party notices, the license and the README; dependencies,
including `@moguri-dev/sdk`, install normally beside it.

## Versions

- [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html). Prerelease versions
  (for example `0.32.0-alpha.1`) publish under the npm dist-tag named by their
  prerelease identifier (`alpha`) and as a GitHub prerelease; stable versions
  use `latest`.
- The TUI, the SDK and the desktop app version independently. The SDK's
  `PROTOCOL_VERSION` is their compatibility contract: clients reuse a healthy
  service only when protocols match. This package pins an exact
  `@moguri-dev/sdk` version, so each TUI release speaks the protocol of the SDK
  release it pins.

## Steps

1. When the release needs SDK changes, release `@moguri-dev/sdk` first (see
   [its releasing guide](https://github.com/moguri-dev/moguri-sdk/blob/main/docs/releasing.md))
   and bump the exact pin here.
2. Update `version` in `package.json` and `package-lock.json` on a branch, run
   the full local checks (`npm ci`, `npm audit --audit-level=moderate`,
   `npm run typecheck`, `npm run build`, `npm test`, `npm run verify:package`)
   and merge it.
3. Tag the merge commit `v<version>` (annotated) and push the tag.
4. [`release.yml`](../.github/workflows/release.yml) runs on macOS. It checks
   that the tag matches the package version, runs `npm ci`, the audit and
   typecheck, builds, packs the package without lifecycle scripts (so the
   `prepack` build output stays out of `npm pack --json`), and runs
   `verify:package` on that tarball. It then publishes the tarball to GitHub
   Packages with the matching dist-tag, unless that version already exists,
   and creates the GitHub release or prerelease with the tarball and
   `SHA512SUMS`, unless the release already exists. It does not rerun the full
   suite: that runs locally before tagging and on `main` CI.

When Actions cannot run, a maintainer may publish the same tag locally from a
clean checkout of the tag after the checks above, with a classic token that
has `write:packages`:

```sh
npm pack
shasum -a 512 moguri-dev-tui-<version>.tgz > SHA512SUMS
npm run verify:package -- moguri-dev-tui-<version>.tgz
npm publish moguri-dev-tui-<version>.tgz --tag <dist-tag>
gh release create v<version> moguri-dev-tui-<version>.tgz SHA512SUMS --title "Moguri TUI <version>" --generate-notes --prerelease
```

Drop `--prerelease` for a stable version. If the tag workflow runs later, it
re-verifies the tag and leaves the existing package version and release
unchanged.

## Consumers

Consumers pin the exact version and keep lockfile `sha512` integrity. Their
project `.npmrc` maps `@moguri-dev` to `https://npm.pkg.github.com`; the token
stays in the user `~/.npmrc`, or `NODE_AUTH_TOKEN` in CI. GitHub Packages
requires a token even for public packages.

The [Moguri desktop app](https://github.com/mbianchidev/moguri) bundles an
exact pin of `@moguri-dev/tui` to ship the CLI and TUI, and installs the
`moguri` command. Bump that pin after a release to deliver it in the app.
