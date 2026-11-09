import { browser } from 'wxt/browser';
import { isRecord } from './object';
import type { MessageKey } from './i18n';

export interface LMStudioModels {
  models: string[];
  error?: string;
}

/** Ask the extension background to contact the local API, never the page itself. */
export async function requestLMStudioModels(): Promise<LMStudioModels> {
  try {
    const response: unknown = await browser.runtime.sendMessage({ type: 'lmstudio:models' });
    if (
      !isRecord(response) ||
      !Array.isArray(response.models) ||
      !response.models.every((id: unknown) => typeof id === 'string')
    ) {
      return { models: [], error: 'invalid-response' };
    }
    return {
      models: response.models as string[],
      ...(typeof response.error === 'string' ? { error: response.error } : {}),
    };
  } catch {
    return { models: [], error: 'offscreen-unavailable' };
  }
}

export function lmStudioErrorLabel(error: string | undefined): MessageKey {
  if (error === 'server-unreachable') return 'lmUnavailable';
  if (error === 'timeout') return 'lmTimeout';
  if (error === 'invalid-response') return 'lmInvalid';
  if (error === 'empty-response') return 'lmEmpty';
  if (error === 'truncated-response') return 'lmTruncated';
  if (error === 'offscreen-unavailable') return 'lmCommunication';
  if (error === 'http-error') return 'lmHttp';
  if (error === 'model-missing' || error === 'model-load-failed') return 'lmModelFailed';
  return 'lmError';
}
