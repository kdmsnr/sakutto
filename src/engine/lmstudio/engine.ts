import { EngineError, isAbortError } from '../errors';
import { ChunkStream } from '../queue/chunk-stream';
import { JobScheduler } from '../queue/scheduler';
import { chunkForTranslation, joinTranslatedSentences } from '../text/sentences';
import type {
  IdentifiedEngine,
  TranslateOptions,
  TranslateSegment,
  TranslationChunk,
} from '../types';
import type { TranslationInput } from './client';

/** One shared scheduler limits all tabs to one local inference at a time. */
export class LmStudioEngine implements IdentifiedEngine {
  readonly kind = 'plamo' as const;
  private readonly scheduler = new JobScheduler(1);

  constructor(
    private readonly client: {
      translate(input: TranslationInput, signal: AbortSignal): Promise<string>;
    },
    private readonly model: string,
    scheduler?: JobScheduler,
  ) {
    if (scheduler) this.scheduler = scheduler;
  }

  async *translate(
    segments: readonly TranslateSegment[],
    options: TranslateOptions,
  ): AsyncIterable<TranslationChunk> {
    if (!this.model)
      throw new EngineError('model-missing', 'Select an LM Studio model in settings.');
    if (options.signal.aborted || segments.length === 0) return;
    const stream = new ChunkStream<TranslationChunk>();
    let remaining = segments.length;
    const handles: Array<{ cancel(): void }> = [];
    const cancel = () => {
      for (const handle of handles) handle.cancel();
      stream.end();
    };
    options.signal.addEventListener('abort', cancel, { once: true });
    for (const segment of segments) {
      handles.push(
        this.scheduler.schedule({
          priority: options.priority,
          run: async () => {
            try {
              if (options.signal.aborted) return;
              const pieces = chunkForTranslation(segment.text);
              if (pieces.length === 0) {
                stream.push({ id: segment.id, final: segment.text, engine: this.kind });
                return;
              }
              const outputs: string[] = [];
              for (const text of pieces) {
                outputs.push(
                  await this.client.translate(
                    {
                      model: this.model,
                      text,
                      tgt: options.tgt,
                      form: options.form,
                      src: options.src,
                      glossary: options.glossary,
                      context: options.context,
                    },
                    options.signal,
                  ),
                );
              }
              if (!options.signal.aborted) {
                stream.push({
                  id: segment.id,
                  final: joinTranslatedSentences(outputs, options.tgt),
                  engine: this.kind,
                });
              }
            } catch (error) {
              if (!options.signal.aborted && !isAbortError(error)) {
                for (const handle of handles) handle.cancel();
                stream.fail(error);
              }
            } finally {
              remaining -= 1;
              if (remaining === 0) stream.end();
            }
          },
        }),
      );
    }
    try {
      yield* stream;
    } finally {
      options.signal.removeEventListener('abort', cancel);
      cancel();
    }
  }
}
