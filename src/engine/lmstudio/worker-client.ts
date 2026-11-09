import { abortError, EngineError, isEngineErrorCode } from '../errors';
import type { TranslationInput } from './client';
import workerUrl from './worker.ts?worker&url';

/** A real worker keeps inference requests in the offscreen document's worker context. */
export class WorkerClient {
  private readonly worker = new Worker(workerUrl, { type: 'module' });
  private readonly pending = new Map<
    string,
    { resolve(value: string): void; reject(error: unknown): void }
  >();

  constructor() {
    this.worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data !== 'object' ||
        data === null ||
        !('id' in data) ||
        typeof data.id !== 'string'
      )
        return;
      const request = this.pending.get(data.id);
      if (!request) return;
      this.pending.delete(data.id);
      if ('text' in data && typeof data.text === 'string') request.resolve(data.text);
      else if (
        'error' in data &&
        typeof data.error === 'object' &&
        data.error !== null &&
        'code' in data.error &&
        isEngineErrorCode(data.error.code) &&
        'message' in data.error &&
        typeof data.error.message === 'string'
      )
        request.reject(new EngineError(data.error.code, data.error.message));
      else
        request.reject(
          new EngineError(
            'invalid-response',
            'The translation worker returned an invalid response.',
          ),
        );
    });
    this.worker.addEventListener('error', () => {
      for (const request of this.pending.values())
        request.reject(new EngineError('offscreen-unavailable', 'The translation worker stopped.'));
      this.pending.clear();
    });
  }

  translate(port: number, input: TranslationInput, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(abortError());
    const id = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
      const cancel = () => {
        this.worker.postMessage({ type: 'cancel', id });
        this.pending.delete(id);
        reject(abortError());
      };
      signal.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, {
        resolve: (text) => {
          signal.removeEventListener('abort', cancel);
          resolve(text);
        },
        reject: (error) => {
          signal.removeEventListener('abort', cancel);
          reject(error);
        },
      });
      this.worker.postMessage({ type: 'translate', id, port, input });
    });
  }
}
