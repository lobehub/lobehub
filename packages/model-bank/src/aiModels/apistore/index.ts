import type { AIChatModelCard } from '../../types/aiModel';
import { apistoreClaudeModels } from './claude';
import { apistoreDeepSeekModels } from './deepseek';
import { apistoreGeminiModels } from './gemini';
import { apistoreGptModels } from './gpt';

// ref: https://apistore.cloud/pricing
// Catalog: https://apistore.cloud/api/public/models (USD per million tokens, read 2026-11-24).
// Every model is served on the OpenAI-compatible Chat Completions endpoint, so reasoning
// is controlled with `reasoning_effort` for all families.
const apistoreChatModels: AIChatModelCard[] = [
  ...apistoreClaudeModels,
  ...apistoreGptModels,
  ...apistoreGeminiModels,
  ...apistoreDeepSeekModels,
];

export default apistoreChatModels;
