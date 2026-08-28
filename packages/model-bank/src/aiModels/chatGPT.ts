import type { AIChatModelCard } from '../types/aiModel';
import { openaiChatModels } from './openai';

const CHATGPT_MODEL_IDS = new Set(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5']);

/**
 * Models available through ChatGPT subscription authentication use the Codex
 * backend rather than the usage-billed OpenAI Platform API. Reuse the OpenAI
 * model metadata, but omit per-token pricing and cap the context window to the
 * current Codex catalog limit.
 */
const chatGPTChatModels: AIChatModelCard[] = openaiChatModels
  .filter(({ id }) => CHATGPT_MODEL_IDS.has(id))
  .map(({ pricing: _pricing, ...model }) => ({
    ...model,
    contextWindowTokens: 272_000,
    settings: {
      ...model.settings,
      extendParams: [...(model.settings?.extendParams || []), 'preserveThinking'],
    },
  }));

export default chatGPTChatModels;
