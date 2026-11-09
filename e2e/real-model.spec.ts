import { expect, test } from '@playwright/test';
import { loadExtension } from './extension';
import { FIXTURE_ORIGIN, commandPage, resetExtensionStorage, waitTranslated } from './page';

test('translates with the local PLaMo model', async () => {
  test.skip(
    process.env.SAKUTTO_E2E_REAL !== '1',
    'Set SAKUTTO_E2E_REAL=1 and start LM Studio to run this smoke test.',
  );

  const port = Number(process.env.SAKUTTO_LM_PORT ?? 1234);
  const response = await fetch(`http://127.0.0.1:${port}/v1/models`);
  if (!response.ok) throw new Error(`LM Studio model list returned ${response.status}`);
  const data = (await response.json()) as { data: Array<{ id: string }> };
  const model =
    process.env.SAKUTTO_LM_MODEL ?? data.data.find((item) => /plamo/i.test(item.id))?.id;
  if (!model)
    throw new Error('No PLaMo model found; set SAKUTTO_LM_MODEL to an available model ID.');
  const extension = await loadExtension('en-US');
  try {
    await resetExtensionStorage(extension.worker);
    await extension.worker.evaluate(
      async ({ port, model }) => {
        const chrome = (
          globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get(key: string): Promise<Record<string, unknown>>;
                  set(value: Record<string, unknown>): Promise<void>;
                };
              };
            };
          }
        ).chrome;
        const stored = await chrome.storage.local.get('settings');
        await chrome.storage.local.set({
          settings: { ...(stored.settings as object), lmStudioPort: port, lmStudioModel: model },
        });
      },
      { port, model },
    );
    const page = await extension.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/article.html`);
    await commandPage(extension.worker, page, 'toggle');
    await waitTranslated(page);
    await expect(page.locator('#lead')).toHaveAttribute('data-sakutto-engine', 'plamo');
    await expect(page.locator('#lead')).not.toContainText('§en§');
    expect(extension.denied).toEqual([]);
    await page.close();
  } finally {
    await extension.close();
  }
});
