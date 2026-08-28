import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

// Chat — this deployment offers different models than upstream's commercial
// defaults below, but still routes them through the same "lobehub" provider.
export const NEW_GLM_MODEL = 'glm-5.2';
export const NEW_GLM_MODEL_NAME = 'GLM-5.2';
export const NEW_KIMI_MODEL = 'kimi-k2.7-code';
export const NEW_KIMI_MODEL_NAME = 'Kimi K2.7 Code';

export const BUSINESS_CHAT_PROVIDER = 'lobehub';
export const OSS_GLM_PROVIDER = 'zhipu';
export const OSS_KIMI_PROVIDER = 'moonshot';

export const CPC_CHAT_PROVIDER = 'lobehub';
export const CPC_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const CPC_DEEPSEEK_MODEL_NAME = 'V4 Flash';
export const CPC_DOUBAO_MODEL = 'doubao-seed-2.1-pro';
export const CPC_DOUBAO_MODEL_NAME = '豆包 2.1';

// Image — kept only for OSS_HOME_NEW_MODELS below; this deployment (see
// BUSINESS_HOME_NEW_MODELS) doesn't have an image slot.
export const NEW_IMAGE_MODEL = 'gpt-image-2';
export const NEW_IMAGE_MODEL_NAME = 'GPT Image 2';

// Video
export const NEW_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
export const NEW_VIDEO_MODEL_NAME = 'Seedance 2.0';

// Deployment-specific list for this private-label build — no image slot, and
// both chat models are ones this deployment actually offers. Not derived from
// the upstream BUSINESS_/OSS_ constants above: keeping this literal rather
// than reusing them means a future canary sync touching those defaults
// doesn't silently drag them back in here.
export const BUSINESS_HOME_NEW_MODELS = [
  {
    model: CPC_DEEPSEEK_MODEL,
    provider: CPC_CHAT_PROVIDER,
    title: CPC_DEEPSEEK_MODEL_NAME,
    type: 'chat',
  },
  {
    model: CPC_DOUBAO_MODEL,
    provider: CPC_CHAT_PROVIDER,
    title: CPC_DOUBAO_MODEL_NAME,
    type: 'chat',
  },
  {
    model: NEW_VIDEO_MODEL,
    title: NEW_VIDEO_MODEL_NAME,
    type: 'video',
  },
] as const satisfies HomeNewModelItem[];

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
] as const satisfies HomeNewModelItem[];
