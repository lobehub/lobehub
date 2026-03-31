import { ChatErrorType } from '@lobechat/types';
import OpenAI from 'openai';

import { getLLMConfig } from '@/envs/llm';

// create OpenAI instance
export const createOpenai = (userApiKey: string | null, endpoint?: string | null) => {
  const { OPENAI_API_KEY } = getLLMConfig();
  const OPENAI_PROXY_URL = process.env.OPENAI_PROXY_URL;

  const baseURL = endpoint || OPENAI_PROXY_URL || undefined;

  const apiKey = userApiKey || OPENAI_API_KEY;

  if (!apiKey) throw new Error('OPENAI_API_KEY is empty', { cause: ChatErrorType.NoOpenAIAPIKey });

  return new OpenAI({ apiKey, baseURL });
};
