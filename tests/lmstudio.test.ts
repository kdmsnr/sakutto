import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LmStudioClient, buildRequest } from '@/engine/lmstudio/client';
import { buildTranslationCacheKey } from '@/engine/cache/key';

let mode = 'ok';
let received: Record<string, unknown> | null = null;

// An in-memory mock of the HTTP API also runs in environments where listening on
// localhost is prohibited. It exercises request serialization and response handling.
beforeEach(() => {
  mode = 'ok';
  received = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (mode === 'refused') throw new TypeError('Connection refused');
      if (mode === 'hang')
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      if (mode === 'http') return new Response('', { status: 500 });
      if (mode === 'bad-json') return new Response('not json');
      if (url.endsWith('/models'))
        return Response.json({ data: [{ id: 'plamo-test' }, { id: 'another' }] });
      received = JSON.parse(String(init.body)) as Record<string, unknown>;
      return Response.json({
        choices: [
          {
            finish_reason: mode === 'truncated' ? 'length' : 'stop',
            message: { content: mode === 'empty' ? '' : 'こんにちは。' },
          },
        ],
      });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const input = { model: 'plamo-test', text: 'Hello.', tgt: 'ja', form: 'plain' as const };
const signal = () => new AbortController().signal;

describe('LM Studio client against a mock server', () => {
  it('lists model IDs and translates with the selected ID', async () => {
    mode = 'ok';
    const client = new LmStudioClient(1234);
    expect(await client.models()).toEqual(['plamo-test', 'another']);
    expect(await client.translate(input, signal())).toBe('こんにちは。');
    expect(received?.model).toBe('plamo-test');
    await client.translate({ ...input, model: 'another' }, signal());
    expect(received?.model).toBe('another');
  });
  it.each([
    ['http', 'http-error'],
    ['bad-json', 'invalid-response'],
    ['empty', 'empty-response'],
    ['truncated', 'truncated-response'],
  ])('reports %s', async (condition, code) => {
    mode = condition;
    await expect(new LmStudioClient(1234).translate(input, signal())).rejects.toMatchObject({
      code,
    });
  });
  it('classifies a timeout and an explicit cancellation separately', async () => {
    mode = 'hang';
    await expect(new LmStudioClient(1234, 20).translate(input, signal())).rejects.toMatchObject({
      code: 'timeout',
    });
    const controller = new AbortController();
    const pending = new LmStudioClient(1234).translate(input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
  });
  it('reports a refused connection', async () => {
    mode = 'refused';
    await expect(new LmStudioClient(1234, 100).models()).rejects.toMatchObject({
      code: 'server-unreachable',
    });
  });
  it('rejects redirects for model discovery and translation requests', async () => {
    const client = new LmStudioClient(1234);
    await client.models();
    await client.translate(input, signal());
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(init?.redirect).toBe('error');
    }
  });
});

describe('PLaMo request and cache identity', () => {
  it('encodes form, directional glossary, context and the unchanged source', () => {
    const request = buildRequest({
      ...input,
      src: 'en',
      form: 'polite',
      glossary: [{ source: 'Hello', target: 'こんにちは' }],
      context: 'Context.',
    });
    expect(request.messages).toEqual([
      {
        role: 'system',
        content:
          '[plamo-translate]\ntarget_lang=ja\nsource_lang=en\nform=polite\nglossary=Hello => こんにちは\n---\nContext.',
      },
      { role: 'user', content: 'Hello.' },
    ]);
    expect(request.stop).toEqual(['<|plamo:tag|>', '<|plamo:bos|>']);
    expect(request.temperature).toBe(0);
    expect(buildRequest({ ...input, tgt: 'en' }).messages[0]?.content).toBe(
      '[plamo-translate]\ntarget_lang=en',
    );
    expect(buildRequest(input).messages[0]?.content).toContain('form=plain');
  });
  it('changes with model and context', () => {
    const key = { model: 'one', text: 'bank', tgt: 'ja', form: 'plain' as const };
    expect(buildTranslationCacheKey({ ...key, model: 'two' })).not.toBe(
      buildTranslationCacheKey(key),
    );
    expect(buildTranslationCacheKey({ ...key, context: 'river' })).not.toBe(
      buildTranslationCacheKey({ ...key, context: 'finance' }),
    );
  });
});

describe('LM Studio translation queue', () => {
  it('serializes requests across engine instances and preserves the requested model', async () => {
    const { LmStudioEngine } = await import('@/engine/lmstudio/engine');
    const { JobScheduler } = await import('@/engine/queue/scheduler');
    const scheduler = new JobScheduler(1);
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const client = {
      translate: async ({ model }: { model: string }) => {
        active += 1;
        peak = Math.max(peak, active);
        calls.push(model);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return '訳文';
      },
    };
    const options = { tgt: 'ja', form: 'plain' as const, priority: 1, signal: signal() };
    const collect = async (engine: InstanceType<typeof LmStudioEngine>, id: string) => {
      const chunks = [];
      for await (const chunk of engine.translate([{ id, text: 'Example' }], options))
        chunks.push(chunk);
      return chunks;
    };
    const [first, second] = await Promise.all([
      collect(new LmStudioEngine(client, 'first', scheduler), 'a'),
      collect(new LmStudioEngine(client, 'second', scheduler), 'b'),
    ]);
    expect(peak).toBe(1);
    expect(calls).toEqual(['first', 'second']);
    expect(first[0]).toMatchObject({ id: 'a', final: '訳文' });
    expect(second[0]).toMatchObject({ id: 'b', final: '訳文' });
  });
});
