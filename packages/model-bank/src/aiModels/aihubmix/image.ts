import { gptImage2Schema, nanoBanana2LiteParameters } from '../../const/imageParameters';
import type { AIImageModelCard } from '../../types/aiModel';

export const aihubmixImageModels: AIImageModelCard[] = [
  {
    description:
      "Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite) is Google's fastest and most cost-efficient image generation model, built for high-volume generation and editing.",
    displayName: 'Nano Banana 2 Lite',
    enabled: true,
    id: 'gemini-3.1-flash-lite-image:image',
    parameters: nanoBanana2LiteParameters,
    pricing: {
      approximatePricePerImage: 0.034,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-30',
    type: 'image',
  },
  {
    description:
      "OpenAI's next-generation multimodal image model with native reasoning, up to 4K resolution, near-perfect text rendering, and high-fidelity multilingual support.",
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2Schema,
    pricing: {
      // Medium quality at 1024x1024: ~1767 output tokens * $30/M = $0.053 per image.
      // Source: https://aihubmix.com/model/gpt-image-2
      approximatePricePerImage: 0.053,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    type: 'image',
  },
];
