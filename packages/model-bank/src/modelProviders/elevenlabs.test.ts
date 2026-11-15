import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import ElevenLabsProviderCard from './elevenlabs';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  ElevenLabsProviderCard as ExportedCard,
  getProviderDisplayName,
  isProviderDisableBrowserRequest,
} from './index';

describe('ElevenLabs provider', () => {
  it('is registered under the elevenlabs id', () => {
    expect(ModelProvider.ElevenLabs).toBe('elevenlabs');
    expect(ExportedCard).toBe(ElevenLabsProviderCard);
    expect(DEFAULT_MODEL_PROVIDER_LIST.filter((card) => card.id === 'elevenlabs')).toEqual([
      ElevenLabsProviderCard,
    ]);
    expect(getProviderDisplayName('elevenlabs')).toBe('ElevenLabs');
  });

  it('asks only for an API key and keeps requests on the server', () => {
    expect(ElevenLabsProviderCard).toMatchObject({
      apiKeyUrl: 'https://elevenlabs.io/app/settings/api-keys',
      chatModels: [],
      name: 'ElevenLabs',
      url: 'https://elevenlabs.io',
    });
    expect(ElevenLabsProviderCard.description).toBeTruthy();
    expect(ElevenLabsProviderCard.settings).toMatchObject({
      proxyUrl: { placeholder: 'https://api.elevenlabs.io' },
      showChecker: false,
      showModelFetcher: false,
    });
    // No chat model to check against and no OpenAI-compatible SDK.
    expect(ElevenLabsProviderCard.settings.sdkType).toBeUndefined();
    expect(ElevenLabsProviderCard.checkModel).toBeUndefined();
    expect(isProviderDisableBrowserRequest('elevenlabs')).toBe(true);
  });

  it('contributes only TTS cards to the default model list', () => {
    const cards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.providerId === 'elevenlabs');

    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards.every((card) => card.type === 'tts' && card.source === 'builtin')).toBe(true);
    expect(cards.map((card) => card.id)).toEqual(
      expect.arrayContaining(['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5']),
    );
  });
});
