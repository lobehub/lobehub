import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

// Chat
export const NEW_GLM_MODEL = 'glm-5.2';
export const NEW_GLM_MODEL_NAME = 'GLM-5.2';
export const NEW_KIMI_MODEL = 'kimi-k2.7-code';
export const NEW_KIMI_MODEL_NAME = 'Kimi K2.7 Code';

export const BUSINESS_CHAT_PROVIDER = 'lobehub';
export const OSS_GLM_PROVIDER = 'zhipu';
export const OSS_KIMI_PROVIDER = 'moonshot';

// Image
export const NEW_IMAGE_MODEL = 'gpt-image-2';
export const NEW_IMAGE_MODEL_NAME = 'GPT Image 2';

// Video
export const NEW_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
export const NEW_VIDEO_MODEL_NAME = 'Seedance 2.0';

export const BUSINESS_HOME_NEW_MODELS = [
  {
    model: NEW_GLM_MODEL,
    provider: BUSINESS_CHAT_PROVIDER,
    title: NEW_GLM_MODEL_NAME,
    type: 'chat',
  },
  {
    model: NEW_KIMI_MODEL,
    provider: BUSINESS_CHAT_PROVIDER,
    title: NEW_KIMI_MODEL_NAME,
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

export const OSS_HOME_NEW_MODELS = [
  {
    model: NEW_GLM_MODEL,
    provider: OSS_GLM_PROVIDER,
    title: NEW_GLM_MODEL_NAME,
    type: 'chat',
  },
  {
    model: NEW_KIMI_MODEL,
    provider: OSS_KIMI_PROVIDER,
    title: NEW_KIMI_MODEL_NAME,
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
