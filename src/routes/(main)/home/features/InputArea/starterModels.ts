import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';

import type { HomeNewModelItem } from '@/business/client/hooks/useHomeNewModels';

// Chat
export const NEW_MINIMAX_MODEL = 'MiniMax-M3';
export const NEW_MINIMAX_PROVIDER = ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'minimax';
export const NEW_MINIMAX_MODEL_NAME = 'MiniMax M3';
export const NEW_CHAT_MODEL = 'claude-opus-4-8';
export const NEW_CHAT_PROVIDER = ENABLE_BUSINESS_FEATURES ? 'lobehub' : 'anthropic';
export const NEW_CHAT_MODEL_NAME = 'Claude Opus 4.8';

// Image
export const NEW_IMAGE_MODEL = 'gpt-image-2';
export const NEW_IMAGE_MODEL_NAME = 'GPT Image 2';

// Video
export const NEW_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
export const NEW_VIDEO_MODEL_NAME = 'Seedance 2.0';

const BUSINESS_HOME_NEW_MODELS = [
  {
    model: NEW_MINIMAX_MODEL,
    provider: NEW_MINIMAX_PROVIDER,
    title: NEW_MINIMAX_MODEL_NAME,
    type: 'chat',
  },
  {
    model: NEW_CHAT_MODEL,
    provider: NEW_CHAT_PROVIDER,
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

const OSS_HOME_NEW_MODELS = [
  {
    model: NEW_CHAT_MODEL,
    provider: NEW_CHAT_PROVIDER,
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

export const DEFAULT_HOME_NEW_MODELS = ENABLE_BUSINESS_FEATURES
  ? BUSINESS_HOME_NEW_MODELS
  : OSS_HOME_NEW_MODELS;
