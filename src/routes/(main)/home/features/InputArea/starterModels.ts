import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

// Chat — first starter slot
export const NEW_CHAT_MODEL = 'claude-opus-4-8';
export const NEW_CHAT_PROVIDER = ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'anthropic';
export const NEW_CHAT_MODEL_NAME = 'Claude Opus 4.8';

// Image
export const NEW_IMAGE_MODEL = 'gpt-image-2';
export const NEW_IMAGE_MODEL_NAME = 'GPT Image 2';

// Video
export const NEW_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
export const NEW_VIDEO_MODEL_NAME = 'Seedance 2.0';

export const DEFAULT_HOME_NEW_MODELS = [
  {
    model: NEW_CHAT_MODEL,
    title: NEW_CHAT_MODEL_NAME,
    type: 'chat',
  },
  {
    model: NEW_IMAGE_MODEL,
    title: NEW_IMAGE_MODEL_NAME,
    type: 'image',
  },
  {
    model: NEW_VIDEO_MODEL,
    title: NEW_VIDEO_MODEL_NAME,
    type: 'video',
  },
] satisfies HomeNewModelItem[];
