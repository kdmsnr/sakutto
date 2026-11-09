import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { EngineClient } from '@/background/engine-client';
import { OffscreenController } from '@/background/offscreen-lifecycle';
import { installPageActions } from '@/background/page-actions';
import { broadcastModelProgress, shouldWarmDownloadedModel } from '@/background/progress-broadcast';
import { measureQuality } from '@/background/quality';
import { TranslationBroker } from '@/background/translation-broker';
import { grantOriginsFor } from '@/dom/sites';
import { LmStudioClient } from '@/engine/lmstudio/client';
import { toEngineError } from '@/engine/errors';
import { DEFAULT_MODEL_ID, getModel, type ModelId } from '@/engine/model/catalog';
import { hasLicenseConsent } from '@/shared/agreement';
import {
  isCacheClearRequest,
  isEngineCapabilitiesRequest,
  isEngineStatusRequest,
  isEngineTierRequest,
  isEngineWarmRequest,
  isModelCancelRequest,
  isOpenSetupRequest,
  isShortcutQuery,
  isSiteGrantRequest,
  isModelDeleteRequest,
  isModelDownloadRequest,
  isModelInspectRequest,
  isModelUseRequest,
  isQualitySampleRequest,
  type ModelProgressMessage,
} from '@/shared/messages';
import { ensureSettings } from '@/shared/storage';
import { readShortcutSnapshot } from '@/shared/shortcuts';

const OFFSCREEN_PAGE = 'offscreen.html';

function createOffscreenController(): OffscreenController {
  return new OffscreenController({
    hasDocument: async () => {
      const contexts = await browser.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [browser.runtime.getURL(`/${OFFSCREEN_PAGE}`)],
      });
      return contexts.length > 0;
    },
    createDocument: async () => {
      await browser.offscreen.createDocument({
        url: OFFSCREEN_PAGE,
        reasons: [browser.offscreen.Reason.WORKERS],
        justification:
          'Runs a worker for long local translation requests independently of the toolbar UI.',
      });
    },
    closeDocument: async () => {
      await browser.offscreen.closeDocument();
    },
  });
}

export default defineBackground(() => {
  const client = new EngineClient(createOffscreenController());
  const broker = new TranslationBroker(client);
  const downloads = new Map<ModelId, AbortController>();

  broker.start();
  installPageActions(broker);

  async function broadcast(message: ModelProgressMessage): Promise<void> {
    await broadcastModelProgress(message, {
      sendExtension: async (item) => {
        await browser.runtime.sendMessage(item);
      },
      listTabs: () => browser.tabs.query({}),
      sendTab: async (tabId, item) => {
        await browser.tabs.sendMessage(tabId, item);
      },
    });
  }

  async function broadcastStatus(): Promise<void> {
    const status = await client.status().catch(() => null);
    if (!status) return;
    await broadcast({ type: 'model:progress', status: status.model });
  }

  function startDownload(modelId: ModelId): boolean {
    if (downloads.has(modelId)) return true;

    const controller = new AbortController();
    downloads.set(modelId, controller);
    const total = getModel(modelId).size;
    let received = 0;

    void (async () => {
      try {
        const status = await client.downloadModel(modelId, {
          signal: controller.signal,
          onProgress: (progress) => {
            received = progress.received;
            void broadcast({ type: 'model:progress', status: progress });
          },
        });
        await broadcast({ type: 'model:progress', status });
        const current = await client.status().catch(() => null);
        if (shouldWarmDownloadedModel(status, current?.model ?? null)) {
          const warmed = await client.warmModel().catch(() => null);
          if (warmed) await broadcast({ type: 'model:progress', status: warmed });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          await broadcastStatus();
          return;
        }

        await broadcast({
          type: 'model:progress',
          status: {
            id: modelId,
            state: 'error',
            received,
            total,
            progress: Math.min(1, received / total),
            error: error instanceof Error ? error.message : String(error),
          },
        });
      } finally {
        downloads.delete(modelId);
      }
    })();

    return true;
  }

  async function deleteModel(modelId: ModelId) {
    downloads.get(modelId)?.abort();
    downloads.delete(modelId);
    return client.deleteModel(modelId).catch(() => null);
  }

  browser.runtime.onInstalled.addListener(({ reason }) => {
    void (async () => {
      await ensureSettings();
      if (reason === 'install') {
        await browser.tabs.create({ url: browser.runtime.getURL('/options.html') });
      }
    })().catch(() => undefined);
  });

  let warmStarted = false;

  async function warmStoredModel(): Promise<void> {
    if (warmStarted) return;
    warmStarted = true;
    const settings = await ensureSettings();
    if (!hasLicenseConsent(settings)) return;
    const status = await client.modelStatus(DEFAULT_MODEL_ID).catch(() => null);
    if (!status || (status.state !== 'ready' && status.state !== 'loaded')) return;
    const warmed = await client.warmModel().catch(() => null);
    if (warmed) await broadcast({ type: 'model:progress', status: warmed });
  }

  void warmStoredModel();
  browser.runtime.onStartup.addListener(() => {
    void warmStoredModel();
  });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id) return false;

    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'lmstudio:models'
    ) {
      if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
      void ensureSettings()
        .then((settings) => new LmStudioClient(settings.lmStudioPort).models())
        .then(
          (models) => sendResponse({ models }),
          (error: unknown) => sendResponse({ models: [], error: toEngineError(error).code }),
        );
      return true;
    }

    if (isEngineCapabilitiesRequest(message)) {
      sendResponse(null);
      return false;
    }

    if (isEngineStatusRequest(message)) {
      void client.status().then(sendResponse, () => sendResponse(null));
      return true;
    }

    if (isSiteGrantRequest(message)) {
      const origins = grantOriginsFor(sender.tab?.url, message.host);
      if (!origins) {
        sendResponse(false);
        return true;
      }
      // permissions.request() only succeeds in an extension page during a user gesture.
      void browser.permissions
        .contains({ origins })
        .then(async (granted) => {
          if (granted) {
            sendResponse(true);
            return;
          }
          const url = new URL(browser.runtime.getURL('/grant.html'));
          url.searchParams.set('host', message.host);
          await browser.windows.create({
            url: url.toString(),
            type: 'popup',
            width: 420,
            height: 280,
            focused: true,
          });
          sendResponse(false);
        })
        .catch(() => sendResponse(false));
      return true;
    }

    if (isOpenSetupRequest(message)) {
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html') }).then(
        () => sendResponse(true),
        () => sendResponse(false),
      );
      return true;
    }

    if (isShortcutQuery(message)) {
      void browser.commands.getAll().then(
        (commands) => sendResponse(readShortcutSnapshot(commands)),
        () => sendResponse(null),
      );
      return true;
    }

    if (isEngineWarmRequest(message)) {
      void client.warmModel().then(
        (status) => {
          if (status) void broadcast({ type: 'model:progress', status });
          sendResponse(true);
          // A page translated in the same moment should get the runtime before this sample.
          setTimeout(() => {
            void measureQuality(client);
          }, 15_000);
        },
        () => sendResponse(false),
      );
      return true;
    }

    if (isModelInspectRequest(message)) {
      void client.modelStatus(message.modelId).then(sendResponse, () => sendResponse(null));
      return true;
    }

    if (isCacheClearRequest(message)) {
      void client.clearCache().then(
        () => sendResponse(true),
        () => sendResponse(false),
      );
      return true;
    }

    if (isEngineTierRequest(message)) {
      void client.setTier(message.tier).then(
        () => sendResponse(true),
        () => sendResponse(false),
      );
      return true;
    }

    if (isQualitySampleRequest(message)) {
      void measureQuality(client).then(sendResponse, () => sendResponse(null));
      return true;
    }

    if (isModelDownloadRequest(message)) {
      void ensureSettings().then(
        (settings) => {
          if (!hasLicenseConsent(settings)) {
            sendResponse(false);
            return;
          }
          sendResponse(startDownload(message.modelId));
        },
        () => sendResponse(false),
      );
      return true;
    }

    if (isModelCancelRequest(message)) {
      downloads.get(message.modelId)?.abort();
      downloads.delete(message.modelId);
      sendResponse(true);
      return false;
    }

    if (isModelDeleteRequest(message)) {
      void deleteModel(message.modelId).then(
        (status) => {
          if (status) void broadcast({ type: 'model:progress', status });
          sendResponse(status);
        },
        () => sendResponse(null),
      );
      return true;
    }

    if (isModelUseRequest(message)) {
      void client.useModel(message.modelId).then(
        (status) => {
          void broadcast({ type: 'model:progress', status });
          sendResponse(status);
        },
        () => sendResponse(null),
      );
      return true;
    }

    return false;
  });
});
