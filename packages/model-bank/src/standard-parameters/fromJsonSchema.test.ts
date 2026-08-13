import { describe, expect, it } from 'vitest';

import { inferModality, type JsonSchemaObject, jsonSchemaToParameters } from './fromJsonSchema';

/**
 * Trimmed from the published Replicate schema of `prunaai/p-video`: the model
 * that motivated this converter. Its output is an untyped URI string, so the
 * modality can only come from the input side.
 */
const replicateVideoInput: JsonSchemaObject = {
  properties: {
    aspect_ratio: {
      default: '16:9',
      description: 'Aspect ratio of the output video',
      enum: ['16:9', '9:16', '1:1'],
      type: 'string',
    },
    disable_safety_filter: { default: true, type: 'boolean' },
    duration: {
      default: 5,
      description: 'Duration in seconds',
      maximum: 20,
      minimum: 1,
      type: 'integer',
    },
    fps: { default: 24, maximum: 30, minimum: 8, type: 'integer' },
    image: {
      anyOf: [{ format: 'uri', type: 'string' }, { type: 'null' }],
      description: 'First frame',
    },
    last_frame_image: { anyOf: [{ format: 'uri', type: 'string' }, { type: 'null' }] },
    prompt: { default: '', description: 'Text prompt', type: 'string' },
    resolution: { default: '720p', enum: ['480p', '720p', '1080p'], type: 'string' },
    seed: { anyOf: [{ type: 'integer' }, { type: 'null' }], maximum: 2_147_483_647, minimum: 0 },
  },
  type: 'object',
};

const replicateUriOutput = { format: 'uri', title: 'Output', type: 'string' };

describe('inferModality', () => {
  it('reads video from an input-only signal when the output is an untyped URI', () => {
    // The Replicate case: the output alone is indistinguishable from an image.
    expect(inferModality({ input: replicateVideoInput, output: replicateUriOutput })).toBe('video');
  });

  it('reads the modality from a named output property', () => {
    expect(
      inferModality({ output: { properties: { video: { format: 'uri', type: 'string' } } } }),
    ).toBe('video');

    expect(inferModality({ output: { properties: { images: { type: 'array' } } } })).toBe('image');
  });

  it('prefers a named output over the input heuristics', () => {
    // An image model may still expose `duration` for an animation preview.
    expect(
      inferModality({
        input: { properties: { duration: { type: 'integer' } } },
        output: { properties: { images: { type: 'array' } } },
      }),
    ).toBe('image');
  });

  it('falls back to a declared media type', () => {
    expect(inferModality({ output: { contentMediaType: 'video/mp4', type: 'string' } })).toBe(
      'video',
    );
  });

  it('claims image only on a prompt plus a framing input', () => {
    expect(
      inferModality({
        input: {
          properties: {
            height: { type: 'integer' },
            prompt: { type: 'string' },
            width: { type: 'integer' },
          },
        },
      }),
    ).toBe('image');
  });

  it('stays undecided rather than guessing', () => {
    expect(
      inferModality({ input: { properties: { prompt: { type: 'string' } } } }),
    ).toBeUndefined();
    expect(inferModality({})).toBeUndefined();
  });
});

describe('jsonSchemaToParameters - video', () => {
  it('converts the Replicate video input into standard parameters', () => {
    const { parameters } = jsonSchemaToParameters(replicateVideoInput, 'video');

    expect(parameters).toMatchObject({
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1'] },
      duration: { default: 5, max: 20, min: 1, step: 1 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null, max: 2_147_483_647, min: 0 },
    });
  });

  it('reports inputs with no home in the closed vocabulary', () => {
    const { unmapped } = jsonSchemaToParameters(replicateVideoInput, 'video');

    // `fps` and `disable_safety_filter` have no standard parameter: the caller
    // needs to know they were dropped rather than silently converted.
    expect(unmapped).toEqual(['disable_safety_filter', 'fps']);
  });

  it('reads fal string durations as numbers', () => {
    // fal publishes `duration` as a string enum while the standard schema types
    // it as a number.
    const { parameters } = jsonSchemaToParameters(
      {
        properties: {
          duration: { default: '5', enum: ['5', '10'], type: 'string' },
          prompt: { type: 'string' },
        },
      },
      'video',
    );

    expect(parameters.duration).toMatchObject({ default: 5, enum: [5, 10] });
  });

  it('drops an enum-backed string with no enum instead of emitting it half-formed', () => {
    const { parameters, unmapped } = jsonSchemaToParameters(
      { properties: { aspect_ratio: { type: 'string' }, prompt: { type: 'string' } } },
      'video',
    );

    expect(parameters.aspectRatio).toBeUndefined();
    // It was recognised but not convertible, so it is still reported as dropped.
    expect(unmapped).toEqual(['aspect_ratio']);
  });

  it('falls back to the first enum value when the declared default is not in it', () => {
    const { parameters } = jsonSchemaToParameters(
      {
        properties: {
          prompt: { type: 'string' },
          resolution: { default: '4k', enum: ['480p', '720p'], type: 'string' },
        },
      },
      'video',
    );

    expect(parameters.resolution?.default).toBe('480p');
  });

  it('always emits a prompt slot, since the runtime requires one', () => {
    const { parameters } = jsonSchemaToParameters({ properties: {} }, 'video');

    expect(parameters.prompt).toEqual({ default: '' });
  });

  it('keeps a boolean default off unless the schema says otherwise', () => {
    const { parameters } = jsonSchemaToParameters(
      {
        properties: {
          generate_audio: { default: true, type: 'boolean' },
          prompt: { type: 'string' },
          watermark: { type: 'boolean' },
        },
      },
      'video',
    );

    expect(parameters.generateAudio).toMatchObject({ default: true });
    expect(parameters.watermark).toMatchObject({ default: false });
  });
});

describe('jsonSchemaToParameters - image', () => {
  const imageInput: JsonSchemaObject = {
    properties: {
      guidance_scale: { default: 3.5, maximum: 10, minimum: 0, multipleOf: 0.1, type: 'number' },
      height: { default: 1024, maximum: 1536, minimum: 256, type: 'integer' },
      image: { anyOf: [{ format: 'uri', type: 'string' }, { type: 'null' }] },
      num_inference_steps: { default: 28, maximum: 50, minimum: 1, type: 'integer' },
      prompt: { description: 'What to draw', type: 'string' },
      unknown_knob: { type: 'string' },
      width: { default: 1024, maximum: 1536, minimum: 256, type: 'integer' },
    },
  };

  it('maps provider-specific input names onto the standard vocabulary', () => {
    const { parameters, unmapped } = jsonSchemaToParameters(imageInput, 'image');

    expect(parameters).toMatchObject({
      cfg: { default: 3.5, max: 10, min: 0, step: 0.1 },
      height: { default: 1024, max: 1536, min: 256 },
      imageUrl: { default: null },
      prompt: { default: '', description: 'What to draw' },
      steps: { default: 28, max: 50, min: 1 },
      width: { default: 1024, max: 1536, min: 256 },
    });

    expect(unmapped).toEqual(['unknown_knob']);
  });

  it('drops a bounded number that declares no bounds', () => {
    const { parameters } = jsonSchemaToParameters(
      { properties: { prompt: { type: 'string' }, width: { default: 512, type: 'integer' } } },
      'image',
    );

    expect(parameters.width).toBeUndefined();
  });
});
