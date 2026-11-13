import { describe, expect, it } from 'vitest';

import { LOBE_DEFAULT_MODEL_LIST, SUNO_MODEL_VERSIONS } from '../aiModels';
import { ModelProvider } from '../const/modelProvider';
import { AiProviderSettingsSchema } from '../types/aiProvider';
import {
  DEFAULT_MODEL_PROVIDER_LIST,
  getProviderDisplayName,
  isProviderDisableBrowserRequest,
  SunoProviderCard as ExportedCard,
} from './index';
import SunoProviderCard from './suno';

describe('Suno provider', () => {
  it('is registered under the suno id', () => {
    expect(ModelProvider.Suno).toBe('suno');
    expect(ExportedCard).toBe(SunoProviderCard);
    expect(DEFAULT_MODEL_PROVIDER_LIST.filter((card) => card.id === 'suno')).toEqual([
      SunoProviderCard,
    ]);
    expect(getProviderDisplayName('suno')).toBe('Suno');
  });

  it('takes a gateway key and proxy URL, keeps requests on the server and is off by default', () => {
    expect(SunoProviderCard).toMatchObject({ chatModels: [], enabled: false, name: 'Suno' });
    expect(SunoProviderCard.description).toBeTruthy();
    expect(SunoProviderCard.settings).toMatchObject({
      proxyUrl: { placeholder: 'https://api.kie.ai' },
      showModelFetcher: false,
    });
    expect(isProviderDisableBrowserRequest('suno')).toBe(true);
  });

  it('checks credentials instead of chatting with a check model', () => {
    expect(SunoProviderCard.checkModel).toBeUndefined();
    expect(SunoProviderCard.settings.checkMode).toBe('credentials');
    // the checker stays visible
    expect(SunoProviderCard.settings.showChecker).not.toBe(false);
    expect(AiProviderSettingsSchema.parse(SunoProviderCard.settings).checkMode).toBe('credentials');
  });

  it('contributes only text2music cards, one per gateway model version', () => {
    const cards = LOBE_DEFAULT_MODEL_LIST.filter((card) => card.providerId === 'suno');

    expect(cards.map((card) => card.id)).toEqual(['suno-v6', 'suno-v6-wild', 'suno-v6-mini']);
    expect(cards.every((card) => card.type === 'text2music' && card.source === 'builtin')).toBe(
      true,
    );
    expect(cards.every((card) => card.outputsPerRequest === 2)).toBe(true);
    expect(Object.keys(SUNO_MODEL_VERSIONS).sort()).toEqual(cards.map((card) => card.id).sort());
    expect(SUNO_MODEL_VERSIONS['suno-v6']).toBe('V6');
  });
});
