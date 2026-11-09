import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));

import { lmStudioErrorLabel, requestLMStudioModels } from '@/shared/lmstudio-status';

describe('LM Studio model status communication', () => {
  beforeEach(() => sendMessage.mockReset());

  it('distinguishes an extension messaging failure from an unreachable server', async () => {
    sendMessage.mockRejectedValueOnce(new Error('No receiving end'));
    const messageFailure = await requestLMStudioModels();
    expect(lmStudioErrorLabel(messageFailure.error)).toBe('lmCommunication');

    sendMessage.mockResolvedValueOnce({ models: [], error: 'server-unreachable' });
    const serverFailure = await requestLMStudioModels();
    expect(lmStudioErrorLabel(serverFailure.error)).toBe('lmUnavailable');
  });
});
