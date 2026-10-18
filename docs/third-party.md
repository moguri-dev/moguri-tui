# Reused components and licenses

Moguri is original application code, not an OpenCode or Pi fork. Versions are
pinned in `package.json` and `package-lock.json`; upstream license and copyright
notices remain in installed and packaged dependencies.

| Component | License | Use |
| --- | --- | --- |
| Node.js | MIT plus included third-party notices | Pinned 26.x service, worker and CLI runtime; built-in SQLite |
| `@earendil-works/pi-ai` | MIT | GitHub Copilot authentication, account catalog and model transport |
| OpenTUI core and React renderer | MIT | Native terminal rendering |
| React and React DOM | MIT | Shared state hooks and desktop UI |
| Electron | MIT plus Chromium/Node notices | Isolated desktop shell |
| TypeBox | MIT | Public command and private worker validation |
| `ws` | MIT | Authenticated local event transport |
| `node-pty` | MIT | Local PTYs and process ownership |
| `@napi-rs/keyring` | MIT | Explicit OS credential backend |
| `react-markdown`, `remark-gfm` | MIT | Safe Markdown presentation |
| Vite, esbuild, tsx | MIT | Builds and development/test TypeScript execution |
| TypeScript | Apache-2.0 | Static verification |
| Playwright | Apache-2.0 | Hidden Electron end-to-end testing |
| `@electron/packager` | BSD-2-Clause | Development macOS application packaging |

No OpenCode source, branding, provider session store or OAuth implementation was
copied into Moguri. The pi-ai package owns its upstream authentication flow.
Authentication support does not grant a license to a hosted provider or imply
partnership status.
