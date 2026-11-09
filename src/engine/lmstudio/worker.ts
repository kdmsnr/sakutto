import { LmStudioClient, type TranslationInput } from './client';
import { toEngineError } from '../errors';

const requests = new Map<string, AbortController>();
self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      type: 'translate' | 'cancel';
      id: string;
      port: number;
      input: TranslationInput;
    }>,
  ) => {
    const message = event.data;
    if (message.type === 'cancel') {
      requests.get(message.id)?.abort();
      return;
    }
    const controller = new AbortController();
    requests.set(message.id, controller);
    void new LmStudioClient(message.port)
      .translate(message.input, controller.signal)
      .then(
        (text) => self.postMessage({ id: message.id, text }),
        (error: unknown) => {
          const value = toEngineError(error);
          self.postMessage({ id: message.id, error: { code: value.code, message: value.message } });
        },
      )
      .finally(() => requests.delete(message.id));
  },
);
