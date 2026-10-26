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

  describe('settings.reasoningEffort', () => {
    const spec = {
      default: 'medium' as const,
      levels: ['low' as const, 'medium' as const, 'high' as const],
    };

    it('saves the spec of a custom model', () => {
      const values = { ...formValues, settings: { reasoningEffort: spec } };
      expect(pickModelConfigFormValues(values, { cardReasoningEffort: spec }).settings).toEqual({
        reasoningEffort: spec,
      });
    });

    it('does not pin an unchanged card spec onto a builtin model row', () => {
      const values = { ...formValues, settings: { reasoningEffort: spec }, source: 'builtin' };
      expect(
        pickModelConfigFormValues(values, { cardReasoningEffort: spec }).settings?.reasoningEffort,
      ).toBeUndefined();
    });

    it('keeps an earlier saved override when the builtin model is saved again', () => {
      // Regression: comparing against the merged value the form opened with made a
      // saved override look unchanged, so editing only the display name wiped it
      const override = { ...spec, default: 'low' as const };
      const values = {
        ...formValues,
        displayName: 'Renamed',
        settings: { reasoningEffort: override },
        source: 'builtin',
      };
      expect(
        pickModelConfigFormValues(values, { cardReasoningEffort: spec }).settings?.reasoningEffort,
      ).toEqual(override);
    });

    it('saves a builtin model spec the user changed', () => {
      const changed = { ...spec, default: 'high' as const };
      const values = { ...formValues, settings: { reasoningEffort: changed }, source: 'builtin' };
      expect(
        pickModelConfigFormValues(values, { cardReasoningEffort: spec }).settings?.reasoningEffort,
      ).toEqual(changed);
    });
  });
});
