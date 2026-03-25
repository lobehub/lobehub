import { type AIChatModelCard, LOBE_DEFAULT_MODEL_LIST } from 'model-bank';

import { getUnitRateByName } from './pricing';

export const AUTO_MODEL_ID = 'auto';
export const AUTO_MODEL_PROVIDER = 'moonshot';
export const AUTO_MODEL_TARGET_MODEL = 'kimi-k2.5';

const USD = 'USD';
const ADVANCED_BASELINE_PROVIDER = 'openai';
const ADVANCED_BASELINE_MODEL = 'gpt-5.2';

export interface AdvancedModelAccessItem {
  model: string;
  provider: string;
}

const getModelCurrency = (model?: AIChatModelCard) => model?.pricing?.currency || USD;

const findBuiltinModel = (provider: string, model: string) =>
  LOBE_DEFAULT_MODEL_LIST.find((m) => m.providerId === provider && m.id === model);

const getTextInputRate = (model?: AIChatModelCard) =>
  model?.pricing ? getUnitRateByName(model.pricing, 'textInput') : undefined;

const getAdvancedBaseline = () => {
  const baseline = findBuiltinModel(ADVANCED_BASELINE_PROVIDER, ADVANCED_BASELINE_MODEL);
  const baselineRate = getTextInputRate(baseline);
  const baselineCurrency = getModelCurrency(baseline);

  return { baselineCurrency, baselineRate };
};

export const resolveAutoModel = (model: string, provider?: string) => {
  if (model !== AUTO_MODEL_ID) return { model, provider: provider || '' };

  return { model: AUTO_MODEL_TARGET_MODEL, provider: AUTO_MODEL_PROVIDER };
};

export const isAdvancedModel = (provider: string, model: string) => {
  const { baselineCurrency, baselineRate } = getAdvancedBaseline();
  if (baselineRate === undefined) return false;

  const target = findBuiltinModel(provider, model);
  if (!target) return false;

  const targetCurrency = getModelCurrency(target);
  if (targetCurrency !== baselineCurrency) return false;

  const targetRate = getTextInputRate(target);
  if (targetRate === undefined) return false;

  return targetRate > baselineRate;
};

export const canAccessModel = (
  permissions: AdvancedModelAccessItem[] | null | undefined,
  provider: string,
  model: string,
) => {
  if (!isAdvancedModel(provider, model)) return true;

  return !!permissions?.some((item) => item.provider === provider && item.model === model);
};
