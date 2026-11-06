import { CHAT_MODEL_IMAGE_GENERATION_PARAMS } from '../standard-parameters';
import type { AIImageModelCard } from '../types/aiModel';

// Chat models come from the gateway's /v1/models, which lists what each key can use.
// Image models are listed here because /v1/models carries no model type.
// A `:image` id is served through chat completions: see createImage in the runtime.
const steadyrouterImageModels: AIImageModelCard[] = [
  {
    description: 'GPT Image 2 (c) image generation model from OpenAI.',
    displayName: 'gpt-image-2-c',
    enabled: false,
    id: 'gpt-image-2-c',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      },
    },
    type: 'image',
  },
  {
    description: 'Image model for prompt-driven generation, editing, and visual design workflows',
    displayName: 'gpt-image-1.5',
    enabled: false,
    id: 'gpt-image-1.5',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      },
    },
    type: 'image',
  },
  {
    description: 'OpenAI image model for production generation, edits, and brand-safe visual workflows',
    displayName: 'gpt-image-1',
    enabled: false,
    id: 'gpt-image-1',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: 'auto',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
      },
    },
    type: 'image',
  },
  {
    description: 'FLUX.2 [pro] image generation model from Black Forest Labs.',
    displayName: 'flux-2-pro',
    enabled: false,
    id: 'flux-2-pro',
    parameters: {
      prompt: {
        default: '',
      },
    },
    type: 'image',
  },
  {
    description: 'FLUX.1 Kontext [pro] image generation and editing model from Black Forest Labs.',
    displayName: 'flux-kontext-pro',
    enabled: false,
    id: 'flux-kontext-pro',
    parameters: {
      prompt: {
        default: '',
      },
    },
    type: 'image',
  },
  {
    description: 'Seedream 4.5 image generation model from ByteDance.',
    displayName: 'doubao-seedream-4-5-251128',
    enabled: false,
    id: 'doubao-seedream-4-5-251128',
    parameters: {
      prompt: {
        default: '',
      },
    },
    type: 'image',
  },
  {
    description: 'Qwen Image 3.0 image generation model from Alibaba.',
    displayName: 'qwen-image-3.0',
    enabled: false,
    id: 'qwen-image-3.0',
    parameters: {
      prompt: {
        default: '',
      },
    },
    type: 'image',
  },
  {
    description: 'Image model for prompt-driven generation, editing, and visual design workflows',
    displayName: 'grok-imagine-image',
    enabled: false,
    id: 'grok-imagine-image',
    parameters: {
      prompt: {
        default: '',
      },
    },
    type: 'image',
  },
  {
    description: 'Image model for prompt-driven generation, editing, and visual design workflows',
    displayName: 'gemini-3.1-flash-image',
    enabled: false,
    id: 'gemini-3.1-flash-image:image',
    parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
    type: 'image',
  },
  {
    description: 'Fastest, most cost-efficient Gemini image model for high-volume 1K generation and editing',
    displayName: 'gemini-3.1-flash-lite-image',
    enabled: false,
    id: 'gemini-3.1-flash-lite-image:image',
    parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
    type: 'image',
  },
  {
    description: 'Nano Banana Pro for higher-fidelity image generation and design-heavy edits',
    displayName: 'gemini-3-pro-image',
    enabled: false,
    id: 'gemini-3-pro-image:image',
    parameters: CHAT_MODEL_IMAGE_GENERATION_PARAMS,
    type: 'image',
  },
];

export const allModels = [...steadyrouterImageModels];

export default allModels;
