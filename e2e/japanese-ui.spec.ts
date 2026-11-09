import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loadExtension } from './extension';

// Chromium on macOS may ignore --lang and keep the host UI locale. Supplying the actual
// Japanese catalog through the i18n API exercises the rendered UI independently of the host.
const japanese = JSON.parse(
  readFileSync(new URL('../public/_locales/ja/messages.json', import.meta.url), 'utf8'),
) as Record<string, { message: string; placeholders?: Record<string, { content: string }> }>;

test('renders Japanese settings and typed translation controls', async () => {
  const extension = await loadExtension('en-US');
  try {
    for (const path of ['options.html', 'typed.html', 'popup.html']) {
      const page = await extension.context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((catalog) => {
        const i18n = (globalThis as unknown as { chrome: { i18n: Record<string, unknown> } }).chrome
          .i18n;
        i18n.getUILanguage = () => 'ja';
        i18n.getMessage = (key: string, substitutions?: string | string[]) => {
          const entry = catalog[key];
          if (!entry) return '';
          const values = Array.isArray(substitutions) ? substitutions : [substitutions ?? ''];
          return entry.message.replace(/\$([a-zA-Z0-9_]+)\$/g, (match, name: string) => {
            const placeholder = entry.placeholders?.[name.toLowerCase()]?.content;
            return (
              placeholder?.replace(
                /\$(\d+)/g,
                (_, index: string) => values[Number(index) - 1] ?? '',
              ) ?? match
            );
          });
        };
      }, japanese);
      await page.goto(`chrome-extension://${extension.extensionId}/${path}`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
      await expect(page.locator('h1')).toHaveText('lmsakutto');
      if (path === 'options.html') {
        await expect(page.getByLabel('ローカル API のポート')).toBeVisible();
        const form = page.getByLabel('文体（日本語）');
        await form.selectOption('polite');
        await expect(form).toHaveValue('polite');
      } else if (path === 'typed.html') {
        await expect(page.getByRole('button', { name: '翻訳', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'コピー', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: /設定/ })).toBeVisible();
        await expect(page.getByLabel('このページの文体（日本語）')).toBeDisabled();
      }
      expect(errors).toEqual([]);
      if (process.env.SAKUTTO_E2E_SCREENSHOT_DIR) {
        await page.screenshot({
          path: `${process.env.SAKUTTO_E2E_SCREENSHOT_DIR}/${path}.png`,
          fullPage: false,
        });
      }
      await page.close();
    }
  } finally {
    await extension.close();
  }
});
