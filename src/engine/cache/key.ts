import { canonicalLanguage } from '@/shared/languages';
import { sha256Hex } from '../model/sha256';
import type { Formality, GlossaryEntry } from '../types';

export interface CacheKeyInput {
  model: string;
  tgt: string;
  form: Formality;
  text: string;
  src?: string | undefined;
  glossary?: readonly GlossaryEntry[] | undefined;
  context?: string | undefined;
}

export function glossaryVersion(glossary: readonly GlossaryEntry[] | undefined): string {
  if (!glossary || glossary.length === 0) return 'none';
  return sha256Hex(JSON.stringify(glossary.map(({ source, target }) => [source, target])));
}

function languagePart(value: string | undefined): string {
  if (!value || value.trim().length === 0) return 'auto';
  return canonicalLanguage(value) ?? value.trim().toLowerCase();
}

export function buildTranslationCacheKey(input: CacheKeyInput): string {
  return [
    'v3',
    input.model,
    languagePart(input.src),
    languagePart(input.tgt),
    input.form,
    glossaryVersion(input.glossary),
    sha256Hex(input.context ?? ''),
    sha256Hex(input.text),
  ].join('|');
}
