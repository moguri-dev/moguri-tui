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
| `ghostty-web` 0.4.0 and its Ghostty WASM core | MIT | Maintained embedded desktop terminal, VT parsing and canvas rendering; self-hosted WASM, not a custom terminal emulator |
| `@napi-rs/keyring` | MIT | Explicit OS credential backend |
| `react-markdown`, `remark-gfm` | MIT | Safe Markdown presentation |
| Vite, esbuild, tsx | MIT | Builds and development/test TypeScript execution |
| TypeScript | Apache-2.0 | Static verification |
| Playwright | Apache-2.0 | Hidden Electron end-to-end testing |
| `@electron/packager` | BSD-2-Clause | Development macOS application packaging |
| `@modelcontextprotocol/sdk` | MIT | Native gateway, stdio/Streamable HTTP connectors and outward single MCP |
| `sqlite-vec` | MIT/Apache-2.0 | Local project-partitioned lexical-vector database |
| Ajv | MIT | Current external MCP JSON-schema argument validation |
| YAML | ISC | Standard `SKILL.md` front matter |
| ignore | MIT | Root/nested `.gitignore` matching for repository indexing |
| Cheerio | MIT | Bounded approved-page text extraction |
| `@resvg/resvg-js` | MPL-2.0 | Build-only rasterization of Moguri's original SVG mascot |
| NVIDIA NeMo-Speech.cpp 0.2.0 | Apache-2.0 plus included upstream notices | Pinned native local recognizer runtime; notices retained with the downloaded runtime |
| NVIDIA Nemotron 3.5 ASR model | OpenMDW-1.1 | Optional user-downloaded GGUF weights, not bundled or implicitly downloaded |
| `cacache` 21.0.1 | ISC | Native npm-compatible content-addressed archive storage with integrity verification |
| pnpm 12.14.0 | MIT plus included notices | Pinned native script-free installer and shared copy-on-write-capable package store |
| semver 7.8.5 | ISC | Reject unqualified local/Git/executable dependency specifiers before cache admission |

The managed cache's advisory source is the public OSV batch API. Its use
requires explicit approval to disclose public dependency names/versions; it
does not receive repository source or credentials. Linear and GitHub APIs are
accessed only for explicitly enabled read-only integration work.

No OpenCode source, branding, provider session store or OAuth implementation was
copied into Moguri. The pi-ai package owns its upstream authentication flow.
Authentication support does not grant a license to a hosted provider or imply
partnership status.
