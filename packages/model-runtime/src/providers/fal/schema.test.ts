// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  coerceFalInput,
  extractFalInputSchema,
  falInputSchemaToImageParameters,
  falInputSchemaToVideoParameters,
} from './schema';
import { buildFalOpenAPI } from './testUtils';

const IMAGE_SIZE = {
  anyOf: [
    { $ref: '#/components/schemas/ImageSize' },
    {
      enum: ['square_hd', 'square', 'landscape_4_3', 'landscape_16_9', 'auto_2K'],
      type: 'string',
    },
  ],
  default: { height: 2048, width: 2048 },
};

describe('extractFalInputSchema', () => {
  it('resolves the submit operation body and inlines property refs', () => {
    const openapi = buildFalOpenAPI('fal-ai/flux/dev', {
      image_size: IMAGE_SIZE,
      prompt: { type: 'string' },
    });
    (openapi.components.schemas as Record<string, unknown>).ImageSize = {
      properties: { height: { type: 'integer' }, width: { type: 'integer' } },
      type: 'object',
    };

    const input = extractFalInputSchema(openapi, 'fal-ai/flux/dev');

    expect(input?.required).toEqual(['prompt']);
    expect(input?.properties?.image_size.anyOf?.[0]).toMatchObject({
      properties: { width: { type: 'integer' } },
      type: 'object',
    });
  });

  it('returns undefined for a schema expansion error', () => {
    expect(
      extractFalInputSchema({ error: { code: 'x', message: 'y' } }, 'fal-ai/flux/dev'),
    ).toBeUndefined();
  });
});

describe('falInputSchemaToImageParameters', () => {
  it('maps fal fields to the parameters the runtime sends', () => {
    expect(
      falInputSchemaToImageParameters({
        properties: {
          guidance_scale: { default: 3.5, maximum: 20, minimum: 1, type: 'number' },
          image_size: IMAGE_SIZE,
          image_urls: { items: { type: 'string' }, maxItems: 10, type: 'array' },
          num_inference_steps: { default: 28, maximum: 50, minimum: 1, type: 'integer' },
          output_format: { enum: ['jpeg', 'png'], type: 'string' },
          prompt: { type: 'string' },
          seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      }),
    ).toEqual({
      cfg: { default: 3.5, max: 20, min: 1, step: 0.1 },
      imageUrls: { default: [], maxCount: 10 },
      prompt: { default: '' },
      // An object default is not selectable, so an `auto` preset wins over the first value
      size: {
        default: 'auto_2K',
        enum: ['square_hd', 'square', 'landscape_4_3', 'landscape_16_9', 'auto_2K'],
      },
      seed: { default: null },
      steps: { default: 28, max: 50, min: 1, step: 1 },
    });
  });

  it('exposes aspect ratio and resolution enums', () => {
    expect(
      falInputSchemaToImageParameters({
        properties: {
          aspect_ratio: { default: '16:9', enum: ['1:1', '16:9'], type: 'string' },
          image_url: { type: 'string' },
          prompt: { type: 'string' },
          resolution: { enum: ['1K', '2K', '4K'], type: 'string' },
        },
      }),
    ).toEqual({
      aspectRatio: { default: '16:9', enum: ['1:1', '16:9'] },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '1K', enum: ['1K', '2K', '4K'] },
    });
  });

  it('skips endpoints without a prompt', () => {
    expect(
      falInputSchemaToImageParameters({ properties: { image_url: { type: 'string' } } }),
    ).toBeUndefined();
  });

  it('skips endpoints that require an input the runtime does not send', () => {
    expect(
      falInputSchemaToImageParameters({
        properties: { control_image_url: { type: 'string' }, prompt: { type: 'string' } },
        required: ['prompt', 'control_image_url'],
      }),
    ).toBeUndefined();
  });

  it('keeps endpoints whose required inputs are all exposed', () => {
    expect(
      falInputSchemaToImageParameters({
        properties: { image_urls: { type: 'array' }, prompt: { type: 'string' } },
        required: ['prompt', 'image_urls'],
      }),
    ).toEqual({ imageUrls: { default: [] }, prompt: { default: '' } });
  });
});

describe('falInputSchemaToVideoParameters', () => {
  it('turns string duration enums into numbers', () => {
    expect(
      falInputSchemaToVideoParameters({
        properties: {
          aspect_ratio: { default: '16:9', enum: ['16:9', '9:16'], type: 'string' },
          duration: { default: '8s', enum: ['4s', '6s', '8s'], type: 'string' },
          end_image_url: { type: 'string' },
          generate_audio: { default: true, type: 'boolean' },
          image_url: { type: 'string' },
          prompt: { type: 'string' },
          resolution: { default: '720p', enum: ['720p', '1080p'], type: 'string' },
          seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
        },
      }),
    ).toEqual({
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16'] },
      duration: { default: 8, enum: [4, 6, 8] },
      endImageUrl: { default: null, requiresImageUrl: true },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['720p', '1080p'] },
      seed: { default: null },
    });
  });

  it('keeps numeric duration ranges', () => {
    expect(
      falInputSchemaToVideoParameters({
        properties: {
          duration: { default: 5, maximum: 15, minimum: 3, type: 'integer' },
          prompt: { type: 'string' },
        },
      })?.duration,
    ).toEqual({ default: 5, max: 15, min: 3, step: 1 });
  });

  it('skips endpoints that require an input the runtime does not send', () => {
    expect(
      falInputSchemaToVideoParameters({
        properties: { audio_url: { type: 'string' }, prompt: { type: 'string' } },
        required: ['prompt', 'audio_url'],
      }),
    ).toBeUndefined();
  });
});

describe('coerceFalInput', () => {
  it('drops fields the endpoint does not declare and stringifies enum numbers', () => {
    expect(
      coerceFalInput(
        { aspect_ratio: '16:9', duration: 6, prompt: 'p', seed: 3 },
        {
          properties: {
            duration: { enum: ['4s', '6s'], type: 'string' },
            prompt: { type: 'string' },
            seed: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          },
        },
      ),
    ).toEqual({ duration: '6s', prompt: 'p', seed: 3 });
  });

  it('returns the input untouched without a schema', () => {
    expect(coerceFalInput({ duration: 5 }, undefined)).toEqual({ duration: 5 });
  });
});
