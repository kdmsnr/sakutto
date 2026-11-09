import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('LM Studio execution', () => {
  it('does not probe browser GPU capabilities when the extension starts', () => {
    for (const path of ['src/entrypoints/offscreen/main.ts', 'src/entrypoints/background.ts']) {
      const source = readFileSync(resolve(path), 'utf8');
      expect(source).not.toContain('probeCapabilities');
      expect(source).not.toContain('requestEngineProbe');
      expect(source).not.toContain('installAdapterNoiseFilter');
    }
    expect(existsSync(resolve('public/gpu-probe.js'))).toBe(false);
  });
});
