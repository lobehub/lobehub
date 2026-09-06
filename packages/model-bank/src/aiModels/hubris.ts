import type { AIChatModelCard } from '../types/aiModel';

/**
 * A representative slice of the Hubris catalogue (500+ models); the provider
 * ships a model fetcher, so the live list comes from `GET /v1/models`.
 *
 * Prices are intentionally absent. Hubris bills in Russian roubles
 * (`pricing.input_rub_per_million` in its catalogue), and `ModelPriceCurrency`
 * only covers USD and CNY. A rouble figure converted at authoring time would
 * silently drift, so no price is published rather than a wrong one.
 */
const hubrisChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Anthropic’s most capable Sonnet-class model, with a 1M-token context window and selectable reasoning effort. Accepts text, image and file input.',
    displayName: 'Claude Sonnet 5',
    enabled: true,
    id: 'anthropic/claude-sonnet-5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Anthropic’s flagship Opus-class model for the hardest reasoning and agentic work, with a 1M-token context window.',
    displayName: 'Claude Opus 5',
    enabled: true,
    id: 'anthropic/claude-opus-5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Mythos-class Claude model above Opus in capability, with a 1M-token context window and adaptive thinking.',
    displayName: 'Claude Fable 5.1',
    id: 'anthropic/claude-fable-5.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'OpenAI’s GPT-6 Astra, a frontier reasoning model with a 1.05M-token context window and text, image and file input.',
    displayName: 'GPT-6 Astra',
    enabled: true,
    id: 'openai/gpt-6-astra',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'A cost-efficient member of the GPT-5.6 family, tuned for everyday chat and agent work.',
    displayName: 'GPT-5.6 Luna',
    id: 'openai/gpt-5.6-luna',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Google’s fast multimodal model, accepting text, image, audio, video and file input with a 1M-token context window.',
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    id: 'google/gemini-3.8-flash',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'The previous Gemini Flash generation, still multimodal and inexpensive; used as the connectivity check model for this provider.',
    displayName: 'Gemini 3.7 Flash',
    enabled: true,
    id: 'google/gemini-3.7-flash',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek’s flagship text model with strong reasoning and coding performance at a low price point.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek/deepseek-v4-pro',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Moonshot AI’s Kimi K3, a long-context model that accepts text, image and video input.',
    displayName: 'Kimi K3',
    id: 'moonshotai/kimi-k3',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 500_000,
    description:
      'xAI’s Grok 4.6, a reasoning model with a 500K-token context window and image input.',
    displayName: 'Grok 4.6',
    id: 'x-ai/grok-4.6',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_310_720,
    description:
      'Z.ai’s GLM 5.3, a text model with an extra-long 1.3M-token context window.',
    displayName: 'GLM 5.3',
    id: 'z-ai/glm-5.3',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Alibaba’s largest Qwen3 model, strong on multilingual text and tool use.',
    displayName: 'Qwen3 Max',
    id: 'qwen/qwen3-max',
    type: 'chat',
  },
];

export const allModels = [...hubrisChatModels];

export default allModels;
