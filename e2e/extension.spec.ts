import { expect, test } from '@playwright/test';
import { loadExtension } from './extension';

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

test.describe('built extension', () => {
  test('starts the extension service worker', async () => {
    const extension = await loadExtension('en-US');
    try {
      expect(extension.extensionId).toMatch(EXTENSION_ID_PATTERN);
    } finally {
      await extension.close();
    }
  });

  test('renders the popup, options, typed and onboarding pages in English', async () => {
    const extension = await loadExtension('en-US');
    try {
      const pages = ['popup.html', 'options.html', 'onboarding.html', 'typed.html'];

      for (const path of pages) {
        const page = await extension.context.newPage();
        await page.goto(`chrome-extension://${extension.extensionId}/${path}`);
        await expect(page.locator('h1')).toHaveText('lmsakutto');
        if (path === 'onboarding.html') {
          await expect(page).toHaveURL(/\/options\.html$/u);
        }
        if (path === 'options.html') {
          await expect(page.getByRole('link', { name: 'Source code' })).toHaveAttribute(
            'href',
            'https://github.com/jammaru/sakutto',
          );
          // Chrome owns the bindings, so the panel shows them and links to Chrome's editor.
          await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Change shortcuts' })).toBeVisible();
          await expect(page.locator('kbd').first()).toHaveText(/^(Alt|Option)\+A$/u);
        }
        if (path === 'typed.html') {
          await expect(page.locator('textarea')).toBeVisible();
        }
        await page.close();
      }
    } finally {
      await extension.close();
    }
  });

  test('translates the bundled sample page', async () => {
    const extension = await loadExtension('ja');
    try {
      const page = await extension.context.newPage();
      await page.goto(`chrome-extension://${extension.extensionId}/sample.html?to=ja`);
      await expect(page.locator('article h1')).toContainText('§ja§Morning at the station');
      await expect(page.locator('article[data-sample="ja"]')).toHaveCount(0);
      await page.close();
    } finally {
      await extension.close();
    }
  });

  test('renders the pages in Japanese for a Japanese browser', async () => {
    const extension = await loadExtension('ja');
    try {
      const uiLanguage = await extension.worker.evaluate(() => {
        const { chrome } = globalThis as unknown as {
          chrome: { i18n: { getUILanguage(): string } };
        };
        return chrome.i18n.getUILanguage();
      });
      test.skip(
        !uiLanguage.toLowerCase().startsWith('ja'),
        `Chromium UI language is ${uiLanguage}; Japanese is unavailable in this environment.`,
      );
      const pages = ['popup.html', 'options.html', 'onboarding.html', 'typed.html'];

      for (const path of pages) {
        const page = await extension.context.newPage();
        await page.goto(`chrome-extension://${extension.extensionId}/${path}`);
        await expect(page.locator('h1')).toHaveText('lmsakutto');
        if (path === 'onboarding.html') {
          await expect(page).toHaveURL(/\/options\.html$/u);
        }
        if (path === 'options.html') {
          await expect(page.getByRole('link', { name: 'ソースコード' })).toHaveAttribute(
            'href',
            'https://github.com/jammaru/sakutto',
          );
          await expect(
            page.getByRole('heading', { name: 'キーボードショートカット' }),
          ).toBeVisible();
          await expect(
            page.getByRole('button', { name: 'ショートカットキーを変更' }),
          ).toBeVisible();
        }
        if (path === 'typed.html') {
          await expect(page.locator('textarea')).toBeVisible();
        }
        await page.close();
      }
    } finally {
      await extension.close();
    }
  });
});
