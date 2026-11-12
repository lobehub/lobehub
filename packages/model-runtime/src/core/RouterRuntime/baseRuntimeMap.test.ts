import { describe, expect, it } from 'vitest';

import { LobeElevenLabsAI } from '../../providers/elevenlabs';
import { LobeTypeSafeAI } from '../../providers/typesafe';
import { baseRuntimeMap } from './baseRuntimeMap';

describe('baseRuntimeMap', () => {
  it('routes the typesafe api type through the TypeSafe runtime', () => {
    expect(baseRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });

  it('routes the elevenlabs api type through the ElevenLabs speech runtime', () => {
    expect(baseRuntimeMap.elevenlabs).toBe(LobeElevenLabsAI);
  });
});
