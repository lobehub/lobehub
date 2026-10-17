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
});
