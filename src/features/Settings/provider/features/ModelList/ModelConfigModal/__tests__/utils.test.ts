import { UpdateAiModelSchema } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { pickModelConfigFormValues } from '../utils';

// Shape of a merged model list item used as the form's initial values: a custom model row
// whose `config` column is NULL, plus builtin-only settings.
const formValues = {
  abilities: { functionCall: true, vision: false },
  config: null,
  contextWindowTokens: 128_000,
  displayName: 'My Model',
  enabled: true,
  id: 'my-model',
  settings: { extendParams: ['enableReasoning'], searchImpl: 'params' },
  source: 'custom',
  type: 'chat',
};

describe('pickModelConfigFormValues', () => {
  it('produces a payload accepted by UpdateAiModelSchema when config is null', () => {
    // The raw form values are what base-ui getValues() returns and the server rejects
    expect(UpdateAiModelSchema.safeParse(formValues).success).toBe(false);

    const payload = pickModelConfigFormValues(formValues);

    expect(UpdateAiModelSchema.safeParse(payload).success).toBe(true);
    expect(payload.config).toBeUndefined();
  });

  it('keeps only the fields rendered by the form', () => {
    expect(pickModelConfigFormValues(formValues)).toEqual({
      abilities: {
        functionCall: true,
        imageOutput: undefined,
        reasoning: undefined,
        search: undefined,
        video: undefined,
        vision: false,
      },
      config: undefined,
      contextWindowTokens: 128_000,
      displayName: 'My Model',
      settings: { extendParams: ['enableReasoning'] },
      type: 'chat',
    });
  });

  it('submits the cache duration, and drops it when cleared so the default applies', () => {
    const picked = pickModelConfigFormValues({
      ...formValues,
      settings: { ...formValues.settings, contextCachingTTL: '5m' },
    });
    expect(picked.settings).toEqual({ contextCachingTTL: '5m', extendParams: ['enableReasoning'] });
    expect(UpdateAiModelSchema.safeParse(picked).success).toBe(true);

    const cleared = pickModelConfigFormValues({
      ...formValues,
      settings: { ...formValues.settings, contextCachingTTL: null },
    });
    // The column is replaced on save, so a missing key falls back to the provider default.
    expect(cleared.settings?.contextCachingTTL).toBeUndefined();
    expect(cleared.settings?.extendParams).toEqual(['enableReasoning']);
  });

  it('rejects a cache duration outside the supported options', () => {
    expect(UpdateAiModelSchema.safeParse({ settings: { contextCachingTTL: '2h' } }).success).toBe(
      false,
    );
  });

  it('submits the deployment name only when the field is shown', () => {
    const values = { ...formValues, config: { chatConfig: {}, deploymentName: 'gpt-4o-prod' } };

    expect(pickModelConfigFormValues(values, { showDeployName: true }).config).toEqual({
      deploymentName: 'gpt-4o-prod',
    });
    expect(pickModelConfigFormValues(values).config).toBeUndefined();
  });

  it('accepts a null deployment config when the field is shown', () => {
    const payload = pickModelConfigFormValues(formValues, { showDeployName: true });

    expect(UpdateAiModelSchema.safeParse(payload).success).toBe(true);
  });

  it('submits the TTS default voice and drops an empty one', () => {
    const ttsValues = {
      ...formValues,
      settings: { ttsVoice: 'Kore' },
      type: 'tts',
    };

    const payload = pickModelConfigFormValues(ttsValues);
    expect(payload.settings?.ttsVoice).toBe('Kore');
    expect(UpdateAiModelSchema.safeParse(payload).success).toBe(true);

    expect(
      pickModelConfigFormValues({ ...ttsValues, settings: { ttsVoice: '  ' } }).settings?.ttsVoice,
    ).toBeUndefined();
    expect(
      pickModelConfigFormValues({ ...ttsValues, settings: { ttsVoice: ' my voice ' } }).settings
        ?.ttsVoice,
    ).toBe('my voice');
  });

  it('drops the cache duration once the model is no longer a chat model', () => {
    const withTTL = { ...formValues, settings: { contextCachingTTL: '5m' } };

    expect(pickModelConfigFormValues(withTTL).settings?.contextCachingTTL).toBe('5m');
    for (const type of ['embedding', 'tts', 'image']) {
      expect(
        pickModelConfigFormValues({ ...withTTL, type }).settings?.contextCachingTTL,
      ).toBeUndefined();
    }
  });

  it('drops the TTS default voice once the model is no longer a TTS model', () => {
    expect(
      pickModelConfigFormValues({ ...formValues, settings: { ttsVoice: 'Kore' }, type: 'chat' })
        .settings?.ttsVoice,
    ).toBeUndefined();
  });
});
