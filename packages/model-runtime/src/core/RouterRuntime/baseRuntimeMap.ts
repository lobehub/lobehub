import { LobeAnthropicAI } from '../../providers/anthropic';
import { LobeAzureAI } from '../../providers/azureai';
import { LobeBedrockAI } from '../../providers/bedrock';
import { LobeCloudflareAI } from '../../providers/cloudflare';
import { LobeDeepSeekAI } from '../../providers/deepseek';
import { LobeFalAI } from '../../providers/fal';
import { LobeGoogleAI } from '../../providers/google';
import { LobeMinimaxAI } from '../../providers/minimax';
import { LobeMoonshotAI } from '../../providers/moonshot';
import { LobeOpenAI } from '../../providers/openai';
import { LobeQwenAI } from '../../providers/qwen';
import { LobeVertexAI } from '../../providers/vertexai';
import { LobeVolcengineAI } from '../../providers/volcengine';
import { LobeXAI } from '../../providers/xai';
import { LobeXiaomiMiMoAI } from '../../providers/xiaomimimo';
import { LobeZhipuAI } from '../../providers/zhipu';
import type { ApiType, RuntimeClass } from './apiTypes';

export const baseRuntimeMap = {
  anthropic: LobeAnthropicAI,
  azure: LobeAzureAI,
  bedrock: LobeBedrockAI,
  cloudflare: LobeCloudflareAI,
  deepseek: LobeDeepSeekAI,
  fal: LobeFalAI,
  google: LobeGoogleAI,
  minimax: LobeMinimaxAI,
  moonshot: LobeMoonshotAI,
  openai: LobeOpenAI,
  qwen: LobeQwenAI,
  vertexai: LobeVertexAI,
  volcengine: LobeVolcengineAI,
  xai: LobeXAI,
  xiaomimimo: LobeXiaomiMiMoAI,
  zhipu: LobeZhipuAI,
} satisfies Record<ApiType, RuntimeClass>;
