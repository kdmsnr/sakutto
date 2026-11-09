# lmsakutto

lmsakutto is a Chrome extension for translating web pages and entered text with PLaMo 3 Translate running in LM Studio. It is a fork of [Sakutto](https://github.com/jammaru/sakutto) by jammaru.

The extension uses LM Studio's local API for inference. It does not download model weights or run the model inside Chrome.

## Requirements

- Google Chrome
- [LM Studio](https://lmstudio.ai/) and the PLaMo 3 Translate 8B GGUF model
- Node.js 24 or later and pnpm 12 for building

The extension does not bundle model weights. The model is subject to the [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en), separately from lmsakutto's MIT license.

## Setup

1. Download PLaMo 3 Translate 8B in LM Studio and load it.
2. Start the local server from LM Studio's Developer screen, or run `lms server start --port 1234` if the `lms` command is available.
3. In this repository, run:

   ```sh
   pnpm install
   pnpm build
   ```

4. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/chrome-mv3`.
5. Open the extension settings, check the connection, and select PLaMo from the model list. If you changed the server port, enter the same port in the settings.
6. Open the extension from the Chrome toolbar to translate a page or text.

## Use

Use the popup to translate a page, switch between the original and translation, or show both. You can translate selected text from the popup, context menu, or keyboard shortcut. The separate text input screen lets you enter text, translate it, and copy the result. Chrome lists configurable shortcuts at `chrome://extensions/shortcuts`.

In the popup, the target language and display mode are saved for the current site. The Japanese writing style can be overridden for the current page; that override is cleared on navigation or reload. The settings page controls the default target language, writing style and display mode, as well as the LM Studio port and model, glossary, optional context, shortcuts and translation cache. Glossaries can be configured globally or per site.

## Troubleshooting

- If `lms` is unavailable, start the server from LM Studio's Developer screen or install its CLI using LM Studio's instructions.
- If the connection fails, check that the LM Studio server is running and that its port matches the extension setting. The default is `http://127.0.0.1:1234`.
- If the model list is empty, download a model in LM Studio and refresh the list. The list may include models that are not loaded when LM Studio's just-in-time loading is enabled. If the selected model is unavailable, load it in LM Studio and try again.
- If translation is slow or stops, check LM Studio's logs, available memory, and model settings, then try a shorter text.
- If a page cannot be translated, check the extension's site permissions in Chrome and reload the page. Chrome internal pages and other restricted pages cannot run extensions.

## Privacy

Text to be translated is sent to the LM Studio API running on this computer at `127.0.0.1`. The extension does not send translation data to an external cloud service. Settings are stored in Chrome extension storage; cached translations are stored in the extension’s IndexedDB. See [PRIVACY.md](PRIVACY.md).

## Development

Run the checks below after making changes. The mock API test runs in Chromium and does not require a loaded model.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm i18n:check
pnpm test:e2e:api
```

See [docs/BUILDING.md](docs/BUILDING.md) for the full test and packaging commands.

## Licenses

The extension's code is licensed under the [MIT License](LICENSE). The original Sakutto copyright notice is preserved in that file; notices for included software are in [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). PLaMo has its own license and is not bundled with the extension.
