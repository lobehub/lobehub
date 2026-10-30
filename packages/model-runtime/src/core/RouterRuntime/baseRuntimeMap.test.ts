import { describe, expect, it } from 'vitest';

import { LobeTypeSafeAI } from '../../providers/typesafe';
import { baseRuntimeMap } from './baseRuntimeMap';

describe('baseRuntimeMap', () => {
  it('routes the typesafe api type through the TypeSafe runtime', () => {
    expect(baseRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });
});
