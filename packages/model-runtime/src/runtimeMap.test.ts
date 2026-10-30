import { describe, expect, it, vi } from 'vitest';

import { LobeTypeSafeAI } from './providers/typesafe';
import { providerRuntimeMap } from './runtimeMap';

vi.mock('./providers/lobehub', () => ({
  LobeHubAI: class LobeHubAI {},
}));

describe('providerRuntimeMap', () => {
  it('routes the TypeSafe provider through its decision runtime', () => {
    expect(providerRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });
});
