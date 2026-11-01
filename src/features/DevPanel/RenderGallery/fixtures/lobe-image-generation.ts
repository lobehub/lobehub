'use client';

import { defineFixtures, single, variants } from './_helpers';

export default defineFixtures({
  identifier: 'lobe-image-generation',
  fixtures: {
    getImageModelParameters: single({
      args: {
        model: 'gemini-3.1-flash-image-preview:image',
        provider: 'lobehub',
      },
      pluginState: {
        defaultValues: {
          aspectRatio: 'auto',
          imageUrls: [],
          prompt: '',
          resolution: '1K',
        },
        displayName: 'Nano Banana 2',
        model: 'gemini-3.1-flash-image-preview:image',
        parameters: {
          aspectRatio: {
            default: 'auto',
            enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
          },
          imageUrls: {
            default: [],
          },
          prompt: {
            default: '',
            description: 'The image generation or editing prompt.',
          },
          resolution: {
            default: '1K',
            enum: ['512', '1K', '2K', '4K'],
          },
        },
        provider: 'lobehub',
      },
    }),
    listImageModels: variants([
      {
        args: {},
        label: 'Models',
        pluginState: {
          providers: [
            {
              id: 'lobehub',
              models: [
                {
                  description:
                    "Google's fastest native image generation model with conversational editing.",
                  displayName: 'Nano Banana 2',
                  id: 'gemini-3.1-flash-image-preview:image',
                  parameters: {
                    aspectRatio: { default: 'auto' },
                    imageUrls: { default: [] },
                    prompt: { default: '' },
                    resolution: { default: '1K' },
                  },
                },
                {
                  description: 'A lightweight image model optimized for fast 1K generation.',
                  displayName: 'Nano Banana 2 Lite',
                  id: 'gemini-3.1-flash-lite-image:image',
                  parameters: {
                    aspectRatio: { default: 'auto' },
                    imageUrls: { default: [] },
                    prompt: { default: '' },
                  },
                },
                {
                  description:
                    'A high-fidelity image model for complex composition and typography.',
                  displayName: 'Nano Banana Pro',
                  id: 'gemini-3-pro-image-preview:image',
                  parameters: {
                    aspectRatio: { default: 'auto' },
                    imageUrls: { default: [] },
                    prompt: { default: '' },
                    resolution: { default: '1K' },
                  },
                },
                {
                  description: 'OpenAI image generation and editing model.',
                  displayName: 'GPT Image 2',
                  id: 'gpt-image-2',
                  parameters: {
                    imageUrls: { default: [] },
                    prompt: { default: '' },
                    size: { default: '1024x1024' },
                  },
                },
                {
                  description: 'Fast image generation model for general-purpose creative work.',
                  displayName: 'Seedream 5 Lite',
                  id: 'seedream-5-0-260128',
                  parameters: {
                    imageUrls: { default: [] },
                    prompt: { default: '' },
                    seed: { default: null },
                    size: { default: '2048x2048' },
                  },
                },
                {
                  description: 'Image editing model with instruction-following controls.',
                  displayName: 'Qwen Edit',
                  id: 'fal-ai/qwen-image-edit',
                  parameters: {
                    cfg: { default: 4 },
                    imageUrl: { default: null },
                    prompt: { default: '' },
                    seed: { default: null },
                  },
                },
                {
                  description: 'General-purpose text-to-image model from the Qwen family.',
                  displayName: 'Qwen Image',
                  id: 'fal-ai/qwen-image',
                  parameters: {
                    cfg: { default: 4 },
                    prompt: { default: '' },
                    seed: { default: null },
                  },
                },
              ],
              name: 'LobeHub',
            },
          ],
          totalModels: 7,
        },
      },
      {
        args: {},
        label: 'Empty',
        pluginState: {
          providers: [],
          totalModels: 0,
        },
      },
    ]),
  },
});
