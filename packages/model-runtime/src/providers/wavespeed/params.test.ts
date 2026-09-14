// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildRequestBody } from './params';

describe('buildRequestBody', () => {
  it('should map LobeHub standard parameters to WaveSpeed fields', () => {
    const body = buildRequestBody({
      aspectRatio: '16:9',
      prompt: 'a cat',
      resolution: '2k',
    } as any);

    expect(body).toEqual({ aspect_ratio: '16:9', prompt: 'a cat', resolution: '2k' });
  });

  it('should map imageUrl/imageUrls/endImageUrl to WaveSpeed image fields', () => {
    expect(buildRequestBody({ imageUrl: 'https://a/1.png', prompt: 'x' } as any)).toEqual({
      image: 'https://a/1.png',
      prompt: 'x',
    });

    expect(
      buildRequestBody({ imageUrls: ['https://a/1.png', 'https://a/2.png'], prompt: 'x' } as any),
    ).toEqual({ images: ['https://a/1.png', 'https://a/2.png'], prompt: 'x' });

    expect(
      buildRequestBody({ endImageUrl: 'https://a/last.png', imageUrl: 'https://a/1.png' } as any),
    ).toEqual({ image: 'https://a/1.png', last_image: 'https://a/last.png' });
  });

  it('should map video-specific standard parameters', () => {
    const body = buildRequestBody({
      cameraFixed: true,
      generateAudio: false,
      promptExtend: true,
      webSearch: true,
    } as any);

    expect(body).toEqual({
      camera_fixed: true,
      enable_prompt_expansion: true,
      enable_web_search: true,
      generate_audio: false,
    });
  });

  it("should convert `size` from LobeHub's WxH to WaveSpeed's W*H", () => {
    expect(buildRequestBody({ size: '1280x720' } as any)).toEqual({ size: '1280*720' });
  });

  it('should fold width/height into a single `size` field', () => {
    expect(buildRequestBody({ height: 720, prompt: 'x', width: 1280 } as any)).toEqual({
      prompt: 'x',
      size: '1280*720',
    });
  });

  it('should keep an explicit size over width/height', () => {
    expect(buildRequestBody({ height: 720, size: '2048x2048', width: 1280 } as any)).toEqual({
      height: 720,
      size: '2048*2048',
      width: 1280,
    });
  });

  it('should drop empty values so server-side defaults win', () => {
    expect(
      buildRequestBody({
        aspectRatio: '',
        imageUrls: [],
        prompt: 'x',
        seed: null,
        resolution: undefined,
      } as any),
    ).toEqual({ prompt: 'x' });
  });

  it('should keep falsy-but-meaningful values', () => {
    expect(buildRequestBody({ generateAudio: false, seed: 0 } as any)).toEqual({
      generate_audio: false,
      seed: 0,
    });
  });

  it('should forward unknown model-specific fields untouched', () => {
    expect(buildRequestBody({ enable_base64_output: true, output_format: 'png' } as any)).toEqual({
      enable_base64_output: true,
      output_format: 'png',
    });
  });
});
