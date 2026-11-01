import { ModelProvider } from 'model-bank/modelProvider';

/**
 * i18n key for a model's description in the `models` namespace.
 *
 * LobeHub-hosted models use a dedicated prefix so their copy can be translated
 * independently from same-id self-hosted / third-party provider cards.
 */
export const getModelDescriptionI18nKey = (modelId: string, provider?: string): string =>
  provider === ModelProvider.LobeHub ? `lobehub.${modelId}.description` : `${modelId}.description`;
