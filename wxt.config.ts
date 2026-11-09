import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  imports: false,
  manifestVersion: 3,
  vite: () => ({
    define: {
      __SAKUTTO_FAKE_ENGINE__: JSON.stringify(process.env.SAKUTTO_FAKE_ENGINE === '1'),
    },
  }),
  manifest: {
    name: '__MSG_extensionName__',
    short_name: '__MSG_extensionShortName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'en',
    minimum_chrome_version: '116',
    permissions: ['offscreen', 'storage', 'activeTab', 'scripting', 'contextMenus'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    // The API accepts requests only on the local loopback host.
    host_permissions: ['http://127.0.0.1/*'],
    commands: {
      'translate-page': {
        suggested_key: { default: 'Alt+A' },
        description: '__MSG_commandTranslate__',
      },
      'toggle-bilingual': {
        suggested_key: { default: 'Alt+B' },
        description: '__MSG_commandBilingual__',
      },
      'translate-selection': {
        suggested_key: { default: 'Alt+S' },
        description: '__MSG_commandSelection__',
      },
      'translate-compose': {
        // Chrome accepts at most four suggested_key commands. If this command has no
        // key, the page uses the あA button and the context menu rather than stealing Alt+T.
        suggested_key: { default: 'Alt+T' },
        description: '__MSG_commandCompose__',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
