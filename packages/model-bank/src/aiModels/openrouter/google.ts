import type { AIChatModelCard } from '../../types/aiModel';

/** Google models served through OpenRouter, kept in list order where `index.ts` spreads them. */
export const openrouterGoogleModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Gemini 4 Carbon is Google's strongest model, with state-of-the-art cybersecurity and long-horizon capabilities for sustained agentic coding, multimodal knowledge work, and scientific reasoning.",
    displayName: 'Gemini 4 Carbon',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-4',
    id: 'google/gemini-4-carbon',
    maxOutput: 65_536,
    // https://openrouter.ai/api/v1/models/google/gemini-4-carbon/endpoints
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.1875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-11-10',
    // OpenRouter forwards `thinkingLevel` as `reasoning.effort`. `urlContext` is a Gemini API
    // tool OpenRouter does not proxy, so it is left out.
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['thinkingLevel3'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536 + 65_536,
    description:
      'Gemini 3.1 Flash Image Preview, a.k.a. "Nano Banana 2," is Google’s latest state of the art image generation and editing model, delivering Pro-level visual quality at Flash speed. It combines advanced contextual understanding with fast, cost-efficient inference, making complex image generation and iterative edits significantly more accessible.',
    displayName: 'Nano Banana 2',
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'google/gemini-3.1-flash-image-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      approximatePricePerImage: 0.067,
      units: [
        { name: 'imageOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-26',
    settings: {
      extendParams: ['imageAspectRatio2', 'imageResolution2', 'thinkingLevel4'],
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072 + 32_768,
    description:
      'Nano Banana Pro is Google’s most advanced image-generation and editing model, built on Gemini 3 Pro. It extends the original Nano Banana with significantly improved multimodal reasoning, real-world grounding, and high-fidelity visual synthesis. The model generates context-rich graphics, from infographics and diagrams to cinematic composites, and can incorporate real-time information via Search grounding.',
    displayName: 'Nano Banana Pro',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'google/gemini-3-pro-image-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_768,
    pricing: {
      approximatePricePerImage: 0.134,
      units: [
        { name: 'imageOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      extendParams: ['imageAspectRatio', 'imageResolution'],
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description:
      'Gemini 2.5 Flash Image, a.k.a. "Nano Banana," is now generally available. It is a state of the art image generation model with contextual understanding. It is capable of image generation, edits, and multi-turn conversations.',
    displayName: 'Nano Banana',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'google/gemini-2.5-flash-image',
    knowledgeCutoff: '2025-06',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-07',
    settings: {
      extendParams: ['imageAspectRatio', 'imageResolution'],
    },
    type: 'chat',
  },
];
