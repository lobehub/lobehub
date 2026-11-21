import { type FormInstance, useWatch } from '@lobehub/ui/form';
import type { AiModelType } from 'model-bank';

import { hasContextCachingTTL } from './contextCachingTTLState';

/**
 * Which type-specific fields the model config form shows. Both follow the type picked in the
 * form, so switching it while creating or editing a model shows or hides them right away.
 */
export const useModelConfigFields = (form: FormInstance, type?: AiModelType, provider?: string) => {
  const currentType = (useWatch(form, 'type') as AiModelType | undefined) ?? type;

  return {
    // Prompt caching only applies to chat models.
    showContextCachingTTL: !!provider && hasContextCachingTTL(currentType),
    showTTSVoice: currentType === 'tts',
  };
};
