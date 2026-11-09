import { EngineError, abortError } from '../errors';
import type { Formality, GlossaryEntry } from '../types';
import { canonicalLanguage } from '@/shared/languages';
import { completionTokenBudget } from '../text/tokens';

export interface TranslationRequest {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: number;
  max_tokens: number;
  stop: string[];
}

export interface TranslationInput {
  model: string;
  text: string;
  tgt: string;
  src?: string | undefined;
  form: Formality;
  glossary?: readonly GlossaryEntry[] | undefined;
  context?: string | undefined;
}

/** Options are line-based in the GGUF chat template; never allow a term to inject lines. */
function safeTerm(value: string): boolean {
  return value.trim().length > 0 && !/[\r\n]/u.test(value) && !value.includes('=>');
}

export function buildRequest(input: TranslationInput): TranslationRequest {
  const tgt = input.tgt === 'auto' ? 'auto' : canonicalLanguage(input.tgt);
  const src = input.src ? canonicalLanguage(input.src) : null;
  if (!tgt || (input.src && !src)) {
    throw new EngineError(
      'unsupported-language',
      'The selected language is not supported by PLaMo.',
    );
  }
  const lines = ['[plamo-translate]', `target_lang=${tgt}`];
  if (src && tgt !== 'auto') lines.push(`source_lang=${src}`);
  if (tgt === 'ja') lines.push(`form=${input.form}`);
  for (const entry of input.glossary ?? []) {
    if (safeTerm(entry.source) && safeTerm(entry.target) && input.text.includes(entry.source)) {
      lines.push(`glossary=${entry.source.trim()} => ${entry.target.trim()}`);
    }
  }
  if (input.context?.trim()) lines.push('---', input.context.trim().slice(0, 2000));
  return {
    model: input.model,
    messages: [
      { role: 'system', content: lines.join('\n') },
      { role: 'user', content: input.text },
    ],
    temperature: 0,
    max_tokens: Math.min(4096, Math.max(128, completionTokenBudget(input.text) * 2)),
    stop: ['<|plamo:tag|>', '<|plamo:bos|>'],
  };
}

export function apiBase(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EngineError('invalid-input', 'Invalid LM Studio port.');
  }
  return `http://127.0.0.1:${port}/v1`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class LmStudioClient {
  constructor(
    private readonly port: number,
    private readonly timeoutMs = 180_000,
  ) {}

  async models(signal?: AbortSignal): Promise<string[]> {
    const value = await this.json(
      '/models',
      { method: 'GET' },
      signal,
      Math.min(this.timeoutMs, 10_000),
    );
    if (
      !record(value) ||
      !Array.isArray(value.data) ||
      !value.data.every((item: unknown) => record(item) && typeof item.id === 'string')
    ) {
      throw new EngineError('invalid-response', 'LM Studio returned an invalid model list.');
    }
    return value.data.map((item: { id: string }) => item.id);
  }

  async translate(input: TranslationInput, signal: AbortSignal): Promise<string> {
    if (!input.model.trim()) throw new EngineError('model-missing', 'Select a model in settings.');
    const value = await this.json(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequest(input)),
      },
      signal,
      this.timeoutMs,
    );
    if (!record(value) || !Array.isArray(value.choices) || !record(value.choices[0])) {
      throw new EngineError(
        'invalid-response',
        'LM Studio returned an invalid translation response.',
      );
    }
    const choice = value.choices[0];
    if (choice.finish_reason === 'length')
      throw new EngineError('truncated-response', 'The translation was cut off.');
    if (
      choice.finish_reason !== 'stop' ||
      !record(choice.message) ||
      typeof choice.message.content !== 'string'
    ) {
      throw new EngineError(
        'invalid-response',
        'LM Studio returned an invalid translation response.',
      );
    }
    const output = choice.message.content.trim();
    if (!output)
      throw new EngineError('empty-response', 'LM Studio returned an empty translation.');
    return output;
  }

  private async json(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (signal?.aborted) throw abortError();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(`${apiBase(this.port)}${path}`, {
          ...init,
          // Do not forward source text if the local server redirects to another origin.
          redirect: 'error',
          signal: controller.signal,
        });
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new EngineError('timeout', 'LM Studio timed out.');
        throw new EngineError(
          'server-unreachable',
          'Cannot connect to LM Studio. Start the local server and check the port.',
          { cause: error },
        );
      }
      if (!response.ok) {
        if (response.status === 404)
          throw new EngineError(
            'model-missing',
            'The selected model was not found or is not loaded.',
          );
        throw new EngineError('http-error', `LM Studio returned HTTP ${response.status}.`);
      }
      try {
        return (await response.json()) as unknown;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) throw new EngineError('timeout', 'LM Studio timed out.');
        throw new EngineError('invalid-response', 'LM Studio returned invalid JSON.', {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}
