import type { BuiltinToolManifest } from '@lobechat/types';

import { systemPrompt } from './systemRole';
import { VideoGenerationApiName, VideoGenerationIdentifier } from './types';

export const VideoGenerationManifest: BuiltinToolManifest = {
  api: [
    {
      description:
        'List currently available video generation providers and models. Use when the user asks for model choices or the request needs a specific provider, capability, quality, duration, audio, speed, or price tradeoff.',
      name: VideoGenerationApiName.listVideoModels,
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
              'Optional provider id to inspect, for example "lobehub", "volcengine", or "google".',
            type: 'string',
          },
        },
        required: [],
        type: 'object',
      },
    },
    {
      description:
        'Get the parameter schema and default values for a specific video model. Call this before passing model-specific parameters to generateVideo.',
      name: VideoGenerationApiName.getVideoModelParameters,
      parameters: {
        additionalProperties: false,
        properties: {
          model: {
            description: 'Video model id returned by listVideoModels.',
            type: 'string',
          },
          provider: {
            description: 'Provider id returned by listVideoModels.',
            type: 'string',
          },
        },
        required: ['provider', 'model'],
        type: 'object',
      },
    },
    {
      defaultTimeoutMs: 180_000,
      description:
        'Generate one video and wait by default until its final URL is available. Only use getVideoGenerationStatus if this returns a still-processing result or if waitUntilComplete is false.',
      name: VideoGenerationApiName.generateVideo,
      parameters: {
        additionalProperties: false,
        properties: {
          endImageUrl: {
            description:
              'Accessible final-frame image URL for models that support first-and-last-frame generation.',
            type: ['string', 'null'],
          },
          imageUrl: {
            description: 'Accessible first-frame or reference image URL. Omit for text-to-video.',
            type: ['string', 'null'],
          },
          imageUrls: {
            description:
              'Accessible reference image URLs for models that support multiple references.',
            items: { type: 'string' },
            type: 'array',
          },
          model: {
            description:
              'Video model id. When omitted, the runtime selects an available enabled video model, optionally within the requested provider.',
            type: 'string',
          },
          parameters: {
            additionalProperties: true,
            description:
              'Model-specific generation parameters. Call getVideoModelParameters first and only pass supported keys such as aspectRatio, resolution, size, duration, cameraFixed, generateAudio, promptExtend, watermark, webSearch, or seed.',
            type: 'object',
          },
          prompt: {
            description:
              'The video prompt. Describe the subject, action, camera movement, scene, style, pacing, and constraints.',
            type: 'string',
          },
          provider: {
            description:
              'Video provider id. When omitted, the runtime resolves it from the requested model or its available model selection.',
            type: 'string',
          },
          waitTimeoutMs: {
            default: 120_000,
            description:
              'Maximum time in milliseconds to wait for the final video URL when waitUntilComplete is enabled. Defaults to 120000; max is 175000.',
            maximum: 175_000,
            minimum: 1000,
            type: 'number',
          },
          waitUntilComplete: {
            default: true,
            description:
              'Whether to wait for the final video URL before returning. Defaults to true. Set false only when explicitly starting a background video task.',
            type: 'boolean',
          },
        },
        required: ['prompt'],
        type: 'object',
      },
      renderDisplayControl: 'alwaysExpand',
    },
    {
      description:
        'Check the video generation item returned by generateVideo. Use only after generateVideo says it is still pending/processing, or after calling generateVideo with waitUntilComplete=false.',
      name: VideoGenerationApiName.getVideoGenerationStatus,
      parameters: {
        additionalProperties: false,
        properties: {
          asyncTaskId: {
            description: 'Async task id returned by generateVideo.',
            type: 'string',
          },
          generationId: {
            description: 'Generation id returned by generateVideo.',
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
  identifier: VideoGenerationIdentifier,
  meta: {
    avatar: '🎬',
    description:
      'Generate videos from chat through LobeHub video generation models, with optional reference frames and model-specific controls.',
    title: 'Video Generation',
  },
  systemRole: systemPrompt,
  type: 'builtin',
};
