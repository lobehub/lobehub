import { describe, expect, it, vi } from 'vitest';

import { LobeNaceAI } from './providers/nace';
import { LobeTypeSafeAI } from './providers/typesafe';
import { providerRuntimeMap } from './runtimeMap';

vi.mock('./providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

describe('providerRuntimeMap', () => {
  it('routes the TypeSafe provider through its decision runtime', () => {
    expect(providerRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });

  it('routes the Nace provider through its decision runtime', () => {
    expect(providerRuntimeMap.nace).toBe(LobeNaceAI);
  });
});
