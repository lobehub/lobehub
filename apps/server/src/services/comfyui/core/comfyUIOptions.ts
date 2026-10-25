import type { ComfyUIKeyVault } from '@lobechat/types';
import { safeParseJSON } from '@lobechat/utils';

import { getLLMConfig } from '@/envs/llm';

/** Apply the same deployment fallback credentials for generation and validation. */
export function resolveComfyUIOptions(vault: ComfyUIKeyVault): ComfyUIKeyVault {
  const env = getLLMConfig();
  return {
    apiKey: vault.apiKey || env.COMFYUI_API_KEY,
    authType: (vault.authType || env.COMFYUI_AUTH_TYPE || 'none') as ComfyUIKeyVault['authType'],
    baseURL: vault.baseURL || env.COMFYUI_BASE_URL || 'http://127.0.0.1:8000',
    customHeaders: vault.customHeaders || safeParseJSON(env.COMFYUI_CUSTOM_HEADERS),
    password: vault.password || env.COMFYUI_PASSWORD,
    username: vault.username || env.COMFYUI_USERNAME,
  };
}
