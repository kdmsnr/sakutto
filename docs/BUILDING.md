# Building lmsakutto

Install Node.js 24 or later and pnpm 12, then run:

```sh
pnpm install
pnpm build
```

Load `dist/chrome-mv3` from `chrome://extensions` with Developer mode enabled. The build does not require Docker, Emscripten, a WebAssembly inference runtime, or model weights. Inference requires LM Studio and a separately installed model at runtime.

For local checks:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm i18n:check
pnpm test:e2e
pnpm test:e2e:api
pnpm zip
```

`pnpm test:e2e:api` builds the production extension and runs a separate mock LM Studio API for the settings, typed-text and page-translation flow. It does not require a downloaded model. The test binds local HTTP ports. By default Playwright installs Chromium; to use an existing Chromium executable that supports loading unpacked extensions, set `SAKUTTO_E2E_CHROME` to its absolute path and `PLAYWRIGHT_SKIP_INSTALL=1`.

`pnpm zip` creates the extension archive in `.output` and checks its contents and manifest. End-to-end tests may require a Chromium installation; see the test output for installation instructions.
