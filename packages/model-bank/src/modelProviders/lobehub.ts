import { BRANDING_NAME } from '@lobechat/business-const';

import type { ModelProviderCard } from '../types';

/**
 * The branded first-party provider. Display metadata follows the business
 * branding slot: OSS/cloud keep the LobeHub identity, while custom-branding
 * distributions (BRANDING_NAME override) get their own name and drop the
 * LobeHub marketing copy/links automatically.
 */
const isCustomBranding = BRANDING_NAME !== 'LobeHub';

const LobeHub: ModelProviderCard = {
  chatModels: [],
  ...(isCustomBranding
    ? {}
    : {
        description:
          'LobeHub Cloud uses official APIs to access AI models and measures usage with Credits tied to model tokens.',
        modelsUrl: 'https://lobehub.com/zh/docs/usage/subscription/model-pricing',
      }),
  enabled: true,
  id: 'lobehub',
  name: BRANDING_NAME,
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: isCustomBranding ? '' : 'https://lobehub.com',
};

export default LobeHub;

export const planCardModels = [
  'deepseek-v4-pro',
  'claude-sonnet-4-6',
  'gemini-3.1-pro-preview',
  'gpt-5.5',
];
