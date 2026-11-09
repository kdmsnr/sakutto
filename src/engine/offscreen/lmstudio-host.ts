import { browser, type Browser } from 'wxt/browser';
import type { EngineStatus, ModelStatus } from '@/shared/engine-status';
import { DEFAULT_MODEL_ID } from '../model/catalog';
import { CachingEngine } from '../cache/caching-engine';
import { TranslationCache } from '../cache/cache';
import { IndexedDbTranslationCacheStore, MemoryTranslationCacheStore } from '../cache/store';
import { isAbortError } from '../errors';
import { LmStudioClient } from '../lmstudio/client';
import { LmStudioEngine } from '../lmstudio/engine';
import { WorkerClient } from '../lmstudio/worker-client';
import { JobScheduler } from '../queue/scheduler';
import {
  ENGINE_HOST_PORT,
  deserializeTranslateOptions,
  errorPayload,
  isEngineHostRequest,
  type EngineHostMessage,
  type TranslateRequest,
  type LocalConnection,
} from './protocol';

export class EngineHost {
  private readonly scheduler = new JobScheduler(1);
  private readonly worker = new WorkerClient();
  private readonly requests = new Map<
    string,
    { controller: AbortController; port: Browser.runtime.Port }
  >();
  private cacheTask: Promise<TranslationCache> | null = null;

  handlePort(port: Browser.runtime.Port): void {
    if (port.name !== ENGINE_HOST_PORT || port.sender?.id !== browser.runtime.id || port.sender.tab)
      return;
    port.onMessage.addListener((message: unknown) => {
      if (!isEngineHostRequest(message)) return;
      if (message.type === 'cancel' || message.type === 'model-cancel') {
        this.requests.get(message.requestId)?.controller.abort();
        this.requests.delete(message.requestId);
      } else if (message.type === 'translate') {
        void this.translate(port, message);
      } else if (message.type === 'ping') {
        this.respond(port, message.requestId, null);
      } else if (message.type === 'status') {
        void this.status(message.connection).then(
          (status) => this.respond(port, message.requestId, status),
          (error: unknown) => this.respondError(port, message.requestId, error),
        );
      } else if (message.type === 'cache-clear') {
        void this.cache()
          .then((cache) => cache.clear())
          .then(
            () => this.respond(port, message.requestId, null),
            (error: unknown) => this.respondError(port, message.requestId, error),
          );
      } else {
        this.respondError(
          port,
          message.requestId,
          new Error('Model management is handled by LM Studio.'),
        );
      }
    });
    port.onDisconnect.addListener(() => {
      for (const [id, request] of this.requests) {
        if (request.port === port) {
          request.controller.abort();
          this.requests.delete(id);
        }
      }
    });
  }

  private cache(): Promise<TranslationCache> {
    if (!this.cacheTask)
      this.cacheTask = IndexedDbTranslationCacheStore.open()
        .then((store) => new TranslationCache(store))
        .catch(() => new TranslationCache(new MemoryTranslationCacheStore()));
    return this.cacheTask;
  }

  private async status(connection: LocalConnection | undefined): Promise<EngineStatus> {
    let ready = false;
    try {
      if (connection) {
        const models = await new LmStudioClient(connection.port).models();
        ready = connection.model.length > 0 && models.includes(connection.model);
      }
    } catch {
      /* An unavailable server must not prevent the settings UI from opening. */
    }
    // The OpenAI-compatible list does not distinguish installed from loaded models.
    const model: ModelStatus = {
      id: DEFAULT_MODEL_ID,
      state: ready ? 'ready' : 'absent',
      received: 0,
      total: 0,
      progress: ready ? 1 : 0,
    };
    return {
      model,
      backend: null,
      tier: null,
      threads: null,
      parallel: null,
      plamoReady: ready,
      chromeSupported: false,
      active: ready ? 'plamo' : null,
    };
  }

  private async translate(port: Browser.runtime.Port, request: TranslateRequest): Promise<void> {
    const controller = new AbortController();
    this.requests.set(request.requestId, { controller, port });
    try {
      const connection = request.connection;
      if (!connection) throw new Error('Missing LM Studio connection settings.');
      const options = deserializeTranslateOptions(request.options, controller.signal);
      const engine = new CachingEngine(
        new LmStudioEngine(
          {
            translate: (input, signal) => this.worker.translate(connection.port, input, signal),
          },
          connection.model,
          this.scheduler,
        ),
        await this.cache(),
        `${connection.port}:${connection.model}`,
      );
      for await (const chunk of engine.translate(request.segments, options)) {
        if (!controller.signal.aborted)
          this.post(port, { type: 'chunk', requestId: request.requestId, chunk });
      }
      if (!controller.signal.aborted)
        this.post(port, { type: 'done', requestId: request.requestId });
    } catch (error) {
      if (!controller.signal.aborted && !isAbortError(error))
        this.post(port, {
          type: 'error',
          requestId: request.requestId,
          error: errorPayload(error),
        });
    } finally {
      this.requests.delete(request.requestId);
    }
  }

  private respond(port: Browser.runtime.Port, requestId: string, value: unknown): void {
    this.post(port, { type: 'response', requestId, ok: true, value });
  }
  private respondError(port: Browser.runtime.Port, requestId: string, error: unknown): void {
    this.post(port, { type: 'response', requestId, ok: false, error: errorPayload(error) });
  }
  private post(port: Browser.runtime.Port, message: EngineHostMessage): void {
    try {
      port.postMessage(message);
    } catch {
      /* disconnected */
    }
  }
}
