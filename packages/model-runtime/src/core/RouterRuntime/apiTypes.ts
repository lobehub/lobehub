import type { LobeRuntimeAI } from '../BaseAI';

export type ApiType =
  | 'anthropic'
  | 'azure'
  | 'bedrock'
  | 'cloudflare'
  | 'deepseek'
  | 'fal'
  | 'google'
  | 'minimax'
  | 'moonshot'
  | 'openai'
  | 'qwen'
  | 'vertexai'
  | 'xai';

export type RuntimeClass = new (options?: any) => LobeRuntimeAI;
