import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { expect, test } from '@playwright/test';
import { loadExtension, type LoadedExtension } from './extension';
import { FIXTURE_ORIGIN, commandPage, waitTranslated } from './page';

interface MockRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

test('connects to LM Studio and translates entered text and a page', async () => {
  test.skip(process.env.SAKUTTO_E2E_MOCK_API !== '1', 'Run with pnpm test:e2e:api.');
  const requests: MockRequest[] = [];
  let stage = 'starting mock API';
  const mark = (next: string) => {
    stage = next;
    console.log(`[mock API E2E] ${next}`);
  };
  mark(stage);
  const server: Server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'plamo-mock' }, { id: 'other-mock' }] }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MockRequest;
        requests.push(body);
        const original = body.messages.find((message) => message.role === 'user')?.content ?? '';
        response.end(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: `訳: ${original}` } }],
          }),
        );
      });
      return;
    }
    response.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock API did not bind to a port');
  let extension: LoadedExtension | undefined;
  try {
    mark('loading extension');
    extension = await loadExtension('en-US');
    mark('opening settings');
    const options = await extension.context.newPage();
    options.setDefaultTimeout(10_000);
    options.setDefaultNavigationTimeout(10_000);
    await options.goto(`chrome-extension://${extension.extensionId}/options.html`);
    mark('editing port');
    await options.getByLabel('Local API port').fill(String(address.port));
    await options.getByLabel('Local API port').dispatchEvent('change');
    mark('checking connection');
    await expect(options.getByText('Connected to LM Studio', { exact: true })).toBeVisible();
    mark('selecting model');
    const model = options
      .locator('label')
      .filter({ has: options.locator('span', { hasText: /^Model$/u }) })
      .locator('select');
    await model.selectOption('plamo-mock');
    await expect(model).toHaveValue('plamo-mock');
    await expect
      .poll(() =>
        extension!.worker.evaluate(async () => {
          const { chrome } = globalThis as unknown as {
            chrome: {
              storage: {
                local: {
                  get(
                    key: string,
                  ): Promise<{ settings?: { lmStudioPort?: number; lmStudioModel?: string } }>;
                };
              };
            };
          };
          const stored = await chrome.storage.local.get('settings');
          return [stored.settings?.lmStudioPort, stored.settings?.lmStudioModel];
        }),
      )
      .toEqual([address.port, 'plamo-mock']);
    await options.getByLabel('Japanese tone').selectOption('polite');
    await expect
      .poll(() =>
        extension!.worker.evaluate(async () => {
          const { chrome } = globalThis as unknown as {
            chrome: {
              storage: { local: { get(key: string): Promise<{ settings?: { form?: string } }> } };
            };
          };
          return (await chrome.storage.local.get('settings')).settings?.form;
        }),
      )
      .toBe('polite');
    await options.close();
    const page = await extension.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/article.html`);
    const popup = await extension.context.newPage();
    await page.bringToFront();
    await popup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
    const form = popup.getByLabel('Japanese tone for this page');
    await expect(form).toBeEnabled();
    await expect(form).toHaveValue('');
    await expect(form.locator('option[value=""]')).toContainText('Polite');
    await expect(popup.getByLabel('Translate into')).toBeVisible();
    await form.selectOption('plain');
    await expect(form).toHaveValue('plain');
    await expect
      .poll(() =>
        extension!.worker.evaluate(async () => {
          const { chrome } = globalThis as unknown as {
            chrome: {
              storage: { local: { get(key: string): Promise<{ settings?: { form?: string } }> } };
            };
          };
          return (await chrome.storage.local.get('settings')).settings?.form;
        }),
      )
      .toBe('polite');
    await popup.reload();
    await expect(popup.getByLabel('Japanese tone for this page')).toHaveValue('plain');
    await page.evaluate(() => history.pushState({}, '', '/docs.html'));
    await page.bringToFront();
    await popup.reload();
    await expect(popup.getByLabel('Japanese tone for this page')).toHaveValue('');
    await popup.close();
    const secondPage = await extension.context.newPage();
    await secondPage.goto(`${FIXTURE_ORIGIN}/article.html`);
    const secondPopup = await extension.context.newPage();
    await secondPage.bringToFront();
    await secondPopup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
    await expect(secondPopup.getByLabel('Japanese tone for this page')).toHaveValue('');
    await secondPopup.close();
    await secondPage.close();
    mark('translating typed text');

    const typed = await extension.context.newPage();
    await typed.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedText: string }).copiedText = text;
          },
        },
      });
    });
    await typed.goto(`chrome-extension://${extension.extensionId}/typed.html`);
    await typed.getByLabel('Translate into').selectOption('ja');
    await expect
      .poll(() =>
        extension!.worker.evaluate(async () => {
          const { chrome } = globalThis as unknown as {
            chrome: {
              storage: {
                local: { get(key: string): Promise<{ settings?: { targetLanguage?: string } }> };
              };
            };
          };
          return (await chrome.storage.local.get('settings')).settings?.targetLanguage;
        }),
      )
      .toBe('ja');
    await typed.locator('textarea').fill('Hello from the mock API.');
    await typed.getByRole('button', { name: 'Translate', exact: true }).click();
    await expect(typed.locator('output.result')).toHaveText('訳: Hello from the mock API.');
    const sent = requests.find((request) =>
      request.messages.some((message) => message.content === 'Hello from the mock API.'),
    );
    expect(sent?.model).toBe('plamo-mock');
    expect(sent?.messages[0]?.content).toContain('[plamo-translate]');
    expect(sent?.messages[0]?.content).toContain('form=polite');
    await typed.getByRole('button', { name: 'Copy', exact: true }).click();
    await expect
      .poll(() => typed.evaluate(() => (window as unknown as { copiedText: string }).copiedText))
      .toBe('訳: Hello from the mock API.');
    await typed.close();

    mark('translating page');
    await commandPage(extension.worker, page, 'toggle');
    await waitTranslated(page);
    await expect(page.locator('#lead')).toContainText('訳:');
    await commandPage(extension.worker, page, 'bilingual');
    await expect(page.locator('#lead sakutto-line')).toContainText('訳:');
    await commandPage(extension.worker, page, 'restore');
    await expect(page.locator('#lead')).toHaveText('今日はよく晴れています。');

    mark('translating selected text');
    await page.evaluate(() => {
      const element = document.querySelector('#lead');
      if (!element?.firstChild) throw new Error('Missing selection fixture');
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, 5);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await commandPage(extension.worker, page, 'selection');
    await expect(page.locator('sakutto-pop')).toBeVisible();
    const accessibility = await extension.context.newCDPSession(page);
    await expect
      .poll(async () => {
        const tree = await accessibility.send('Accessibility.getFullAXTree');
        return JSON.stringify(tree.nodes);
      })
      .toContain('訳: 今日はよく');
    await accessibility.detach();
    await page.close();
    expect(extension.denied).toEqual([]);
  } catch (error) {
    throw new Error(`E2E failed while ${stage}`, { cause: error });
  } finally {
    server.closeAllConnections();
    await extension?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
