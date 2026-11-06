import { describe, expect, it } from 'vitest';

import { LobeNaceAI } from '../../providers/nace';
import { LobeTypeSafeAI } from '../../providers/typesafe';
import { baseRuntimeMap } from './baseRuntimeMap';

describe('baseRuntimeMap', () => {
  it('routes the typesafe api type through the TypeSafe runtime', () => {
    expect(baseRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });

  it('routes the nace api type through the Nace runtime', () => {
    expect(baseRuntimeMap.nace).toBe(LobeNaceAI);
  });
});
