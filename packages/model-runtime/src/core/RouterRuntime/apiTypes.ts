import type { LobeRuntimeAI } from '../BaseAI';

export type ApiType =
  | 'anthropic'
  | 'azure'
  | 'azureopenai'
  | 'bedrock'
  | 'cloudflare'
  | 'deepseek'
  | 'doubaospeech'
  | 'elevenlabs'
  | 'fal'
  | 'fishaudio'
  | 'google'
  | 'meta'
  | 'minimax'
  | 'moonshot'
  | 'openai'
  | 'qwen'
  | 'typesafe'
  | 'vertexai'
  | 'volcengine'
  | 'xai'
  | 'xiaomimimo'
  | 'zhipu';

export type RuntimeClass = new (options?: any) => LobeRuntimeAI;
