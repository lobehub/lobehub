import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { ImageGenerationApiName, ImageGenerationIdentifier } from './types';

export const ImageGenerationManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List currently available image generation providers and models. Use this first when provider/model is not specified or when you need model choices.',
      name: ImageGenerationApiName.listImageModels,
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            description:
              'Maximum models to return per provider. Defaults to a concise list; max is 50.',
            maximum: 50,
            minimum: 1,
            type: 'number',
          },
          provider: {
            description:
              'Optional provider id to inspect, for example "lobehub", "openai", or "fal".',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Get the parameter schema and default values for a specific image model. Call this before passing model-specific parameters to generateImage.',
      name: ImageGenerationApiName.getImageModelParameters,
      parameters: {
        additionalProperties: false,
        properties: {
          model: {
            description: 'Image model id returned by listImageModels.',
            type: 'string',
          },
          provider: {
            description: 'Provider id returned by listImageModels.',
            type: 'string',
          },
        },
        required: ['provider', 'model'],
        type: 'object',
      },
    },
    {
      description:
        'Start an image generation task. Returns batch and async task ids immediately; use getImageGenerationStatus to retrieve final image URLs.',
      name: ImageGenerationApiName.generateImage,
      parameters: {
        additionalProperties: false,
        properties: {
          imageNum: {
            description: 'Number of images to generate. Integer from 1 to 8. Defaults to 1.',
            maximum: 8,
            minimum: 1,
            type: 'number',
          },
          imageUrl: {
            description:
              'Single accessible reference image URL for image-to-image models. Omit for text-to-image.',
            type: ['string', 'null'],
          },
          imageUrls: {
            description:
              'Multiple accessible reference image URLs for models that support multiple references.',
            items: { type: 'string' },
            type: 'array',
          },
          model: {
            description:
              'Image model id. Defaults to the current LobeHub default image model when omitted.',
            type: 'string',
          },
          parameters: {
            additionalProperties: true,
            description:
              'Model-specific generation parameters. Call getImageModelParameters first and only pass supported keys such as size, aspectRatio, resolution, quality, steps, cfg, seed, promptExtend, watermark, or strength.',
            type: 'object',
          },
          prompt: {
            description:
              'The image prompt. Describe visual content, style, composition, and constraints.',
            type: 'string',
          },
          provider: {
            description:
              'Image provider id. Defaults to the current LobeHub default image provider when omitted.',
            type: 'string',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
    {
      description:
        'Check the status of one image generation item returned by generateImage. Use until status is success or error.',
      name: ImageGenerationApiName.getImageGenerationStatus,
      parameters: {
        additionalProperties: false,
        properties: {
          asyncTaskId: {
            description: 'Async task id returned by generateImage.',
            type: 'string',
          },
          generationId: {
            description: 'Generation id returned by generateImage.',
            type: 'string',
          },
        },
        required: ['generationId', 'asyncTaskId'],
        type: 'object',
      },
      renderDisplayControl: 'expand',
    },
  ],
  executors: ['client', 'server'],
  humanIntervention: 'never',
  identifier: ImageGenerationIdentifier,
  meta: {
    avatar: '🎨',
    description:
      'Generate images from chat through LobeHub image generation models, including models that are not native image-output chat models.',
    title: 'Image Generation',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
