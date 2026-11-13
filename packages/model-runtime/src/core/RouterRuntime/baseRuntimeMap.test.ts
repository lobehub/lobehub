import { describe, expect, it } from 'vitest';

import { LobeDoubaoSpeechAI } from '../../providers/doubaospeech';
import { LobeElevenLabsAI } from '../../providers/elevenlabs';
import { LobeFishAudioAI } from '../../providers/fishaudio';
import { LobeTypeSafeAI } from '../../providers/typesafe';
import { baseRuntimeMap } from './baseRuntimeMap';

describe('baseRuntimeMap', () => {
  it('routes the typesafe api type through the TypeSafe runtime', () => {
    expect(baseRuntimeMap.typesafe).toBe(LobeTypeSafeAI);
  });

  it('routes the elevenlabs api type through the ElevenLabs speech runtime', () => {
    expect(baseRuntimeMap.elevenlabs).toBe(LobeElevenLabsAI);
  });

  it('routes the fishaudio api type through the Fish Audio speech runtime', () => {
    expect(baseRuntimeMap.fishaudio).toBe(LobeFishAudioAI);
  });

  it('routes the doubaospeech api type through the Doubao Speech runtime', () => {
    expect(baseRuntimeMap.doubaospeech).toBe(LobeDoubaoSpeechAI);
  });
});
