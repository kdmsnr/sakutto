import { describe, expect, it } from 'vitest';
import { storeZipProblems } from '../scripts/package-artifact';

describe('store zip guard', () => {
  it('requires a non-empty zip', () => {
    expect(storeZipProblems([])).toEqual(['the store zip is missing']);
    expect(storeZipProblems([{ name: 'extension.zip', bytes: 0 }])).toEqual([
      'extension.zip is 0 bytes, below 1',
    ]);
    expect(storeZipProblems([{ name: 'extension.zip', bytes: 1145 }])).toEqual([]);
  });
});
