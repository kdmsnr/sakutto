import { describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS } from '@/shared/shortcuts';
import config from '../wxt.config';

const manifest = config.manifest as unknown as Record<string, unknown>;

describe('extension manifest', () => {
  it('uses the localized name and description', () => {
    expect(manifest.name).toBe('__MSG_extensionName__');
    expect(manifest.short_name).toBe('__MSG_extensionShortName__');
    expect(manifest.description).toBe('__MSG_extensionDescription__');
    expect(manifest.default_locale).toBe('en');
    expect(config.manifestVersion).toBe(3);
  });

  it('requests only the permissions the extension uses', () => {
    expect(manifest.permissions).toEqual([
      'offscreen',
      'storage',
      'activeTab',
      'scripting',
      'contextMenus',
    ]);
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  });

  it('sets a minimum Chrome version that supports offscreen documents', () => {
    expect(manifest.minimum_chrome_version).toBe('116');
  });

  it('does not enable WebAssembly or cross-origin isolation', () => {
    expect(manifest).not.toHaveProperty('content_security_policy');
    expect(manifest).not.toHaveProperty('cross_origin_embedder_policy');
    expect(manifest).not.toHaveProperty('cross_origin_opener_policy');
  });

  it('declares the translation shortcuts', () => {
    expect(manifest.commands).toEqual({
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
        suggested_key: { default: 'Alt+T' },
        description: '__MSG_commandCompose__',
      },
    });
    expect(manifest.permissions).toContain('contextMenus');
    const withSuggested = Object.values(
      manifest.commands as Record<string, { suggested_key?: unknown }>,
    ).filter((command) => command.suggested_key !== undefined);
    expect(withSuggested).toHaveLength(4);
  });

  /**
   * Chrome starts every user on the manifest key, and the hints a page shows before the
   * background answers name that same key. A default that moved in one place only would make
   * the popup advertise a shortcut Chrome never bound.
   */
  it('suggests the same default the page falls back to', () => {
    const commands = manifest.commands as Record<string, { suggested_key: { default: string } }>;
    for (const [name, shortcut] of Object.entries(DEFAULT_SHORTCUTS)) {
      expect(commands[name]?.suggested_key.default, name).toBe(shortcut);
    }
  });

  it('points every icon size at a bundled PNG', () => {
    expect(manifest.icons).toEqual({
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    });
  });
});
