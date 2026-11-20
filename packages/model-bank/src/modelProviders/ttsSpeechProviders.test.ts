import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import DoubaoSpeechProviderCard from './doubaospeech';
import FishAudioProviderCard from './fishaudio';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  DoubaoSpeechProviderCard as ExportedDoubaoCard,
  FishAudioProviderCard as ExportedFishCard,
  getProviderDisplayName,
  isProviderDisableBrowserRequest,
} from './index';

describe.each([
  {
    apiKeyUrl: 'https://fish.audio/app/api-keys',
    card: FishAudioProviderCard,
    enumValue: ModelProvider.FishAudio,
    exported: ExportedFishCard,
    id: 'fishaudio',
    models: ['s2.1-pro', 'drama-3', 's2-pro', 's1'],
    name: 'Fish Audio',
    proxy: 'https://api.fish.audio',
  },
  {
    apiKeyUrl: 'https://console.volcengine.com/speech/new',
    card: DoubaoSpeechProviderCard,
    enumValue: ModelProvider.DoubaoSpeech,
    exported: ExportedDoubaoCard,
    id: 'doubaospeech',
    models: ['seed-tts-2.0'],
    name: 'Doubao Speech',
    proxy: 'https://openspeech.bytedance.com',
  },
])('$name provider', ({ apiKeyUrl, card, enumValue, exported, id, models, name, proxy }) => {
  it(`is registered under the ${id} id`, () => {
    expect(enumValue).toBe(id);
    expect(exported).toBe(card);
    expect(DEFAULT_MODEL_PROVIDER_LIST.filter((item) => item.id === id)).toEqual([card]);
    expect(getProviderDisplayName(id)).toBe(name);
  });

  it('is a server-side TTS provider without checker or model fetcher', () => {
    expect(card).toMatchObject({ apiKeyUrl, chatModels: [], name });
    expect(card.description).toBeTruthy();
    expect(card.settings).toMatchObject({
      proxyUrl: { placeholder: proxy },
      showAddNewModel: false,
      showChecker: false,
      showModelFetcher: false,
    });
    expect(card.settings.sdkType).toBeUndefined();
    expect(card.checkModel).toBeUndefined();
    expect(isProviderDisableBrowserRequest(id)).toBe(true);
  });

  it('contributes only TTS cards to the default model list', () => {
    const cards = LOBE_DEFAULT_MODEL_LIST.filter((item) => item.providerId === id);

    expect(cards.map((item) => item.id)).toEqual(models);
    expect(cards.every((item) => item.type === 'tts' && item.source === 'builtin')).toBe(true);
  });
});

it('keeps Doubao Speech separate from Volcengine Ark', () => {
  expect(ModelProvider.DoubaoSpeech).not.toBe(ModelProvider.Volcengine);
});
