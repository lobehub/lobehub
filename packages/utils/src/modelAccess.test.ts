import { LOBE_DEFAULT_MODEL_LIST } from 'model-bank';
import { describe, expect, it } from 'vitest';

import {
  AUTO_MODEL_ID,
  AUTO_MODEL_PROVIDER,
  AUTO_MODEL_TARGET_MODEL,
  canAccessModel,
  isAdvancedModel,
  resolveAutoModel,
} from './modelAccess';
import { getUnitRateByName } from './pricing';

const getTextInputRate = (providerId: string, modelId: string) => {
  const model = LOBE_DEFAULT_MODEL_LIST.find(
    (m) => m.providerId === providerId && m.id === modelId,
  );
  if (!model?.pricing) return undefined;
  return getUnitRateByName(model.pricing, 'textInput');
};

describe('modelAccess', () => {
  it('should resolve auto model to kimi', () => {
    expect(resolveAutoModel(AUTO_MODEL_ID)).toEqual({
      model: AUTO_MODEL_TARGET_MODEL,
      provider: AUTO_MODEL_PROVIDER,
    });
  });

  it('should keep explicit model/provider unchanged', () => {
    expect(resolveAutoModel('gpt-4o', 'openai')).toEqual({ model: 'gpt-4o', provider: 'openai' });
  });

  it('should identify advanced model by text input rate over gpt-5.2 baseline', () => {
    const baselineRate = getTextInputRate('openai', 'gpt-5.2');
    expect(baselineRate).toBeDefined();

    const candidate = LOBE_DEFAULT_MODEL_LIST.find((m) => {
      const currency = m.pricing?.currency || 'USD';
      if (!m.pricing || currency !== 'USD') return false;
      const rate = getUnitRateByName(m.pricing, 'textInput');
      return rate !== undefined && baselineRate !== undefined && rate > baselineRate;
    });

    expect(candidate).toBeDefined();
    expect(isAdvancedModel(candidate!.providerId, candidate!.id)).toBe(true);
  });

  it('should allow only whitelisted advanced models', () => {
    expect(canAccessModel([], 'openai', 'gpt-5.2')).toBe(true);

    expect(canAccessModel([], 'openai', 'gpt-4o')).toBe(false);
    expect(canAccessModel([{ model: 'gpt-4o', provider: 'openai' }], 'openai', 'gpt-4o')).toBe(
      true,
    );
  });
});
