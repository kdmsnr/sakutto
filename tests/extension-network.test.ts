import { describe, expect, it } from 'vitest';
import { isAllowedRequest } from '../e2e/extension';

describe('extension network allowlist', () => {
  it('allows local fixtures and denies external model downloads', () => {
    expect(isAllowedRequest('http://127.0.0.1:1234/v1/models')).toBe(true);
    expect(isAllowedRequest('http://localhost:4173/article.html')).toBe(true);
    expect(isAllowedRequest('https://huggingface.co/model.gguf')).toBe(false);
    expect(isAllowedRequest('https://cdn-lfs.huggingface.co/repos/file')).toBe(false);
    expect(isAllowedRequest('https://example.com/model.gguf')).toBe(false);
    expect(isAllowedRequest('http://localhost.example.com/model.gguf')).toBe(false);
  });
});
