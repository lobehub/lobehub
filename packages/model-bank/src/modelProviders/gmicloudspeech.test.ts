import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import GmicloudSpeechProviderCard from './gmicloudspeech';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  GmicloudSpeechProviderCard as ExportedCard,
  getProviderDisplayName,
  isProviderDisableBrowserRequest,
} from './index';

describe('GMI Cloud Speech provider', () => {
  it('is registered under the gmicloudspeech id', () => {
    expect(ModelProvider.GmicloudSpeech).toBe('gmicloudspeech');
    expect(ExportedCard).toBe(GmicloudSpeechProviderCard);
    expect(DEFAULT_MODEL_PROVIDER_LIST.filter((card) => card.id === 'gmicloudspeech')).toEqual([
      GmicloudSpeechProviderCard,
    ]);
    expect(getProviderDisplayName('gmicloudspeech')).toBe('GMI Cloud Speech');
  });

  it('asks only for an API key and keeps requests on the server', () => {
    expect(GmicloudSpeechProviderCard).toMatchObject({
      apiKeyUrl: 'https://console.gmicloud.ai/',
      chatModels: [],
      name: 'GMI Cloud Speech',
      url: 'https://www.gmicloud.ai',
    });
    expect(GmicloudSpeechProviderCard.description).toBeTruthy();
    expect(GmicloudSpeechProviderCard.settings).toMatchObject({
      proxyUrl: { placeholder: 'https://console.gmicloud.ai' },
      showChecker: false,
      showModelFetcher: false,
    });
    // No chat model to check against and no OpenAI-compatible SDK.
    expect(GmicloudSpeechProviderCard.settings.sdkType).toBeUndefined();
    expect(GmicloudSpeechProviderCard.checkModel).toBeUndefined();
    expect(isProviderDisableBrowserRequest('gmicloudspeech')).toBe(true);
  });

  it('lists TTS models only, with two enabled speech models', () => {
    const ttsModels = LOBE_DEFAULT_MODEL_LIST.filter(
      (model) => model.providerId === 'gmicloudspeech',
    );
    expect(ttsModels.every((model) => model.type === 'tts')).toBe(true);
    expect(ttsModels.map((model) => model.id).sort()).toEqual([
      'inworld-tts-2',
      'minimax-tts-speech-2.8-turbo',
    ]);
  });
});
