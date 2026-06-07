// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../core/openaiCompatibleFactory';
import { createAiHubMixVideo } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockOptions: CreateVideoOptions = {
  apiKey: 'test-api-key',
  baseURL: 'https://aihubmix.com/v1',
  provider: 'aihubmix',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(global, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper to extract the JSON body from the last fetch call
const getLastBody = () => JSON.parse((global.fetch as any).mock.calls[0][1].body);

// ---------------------------------------------------------------------------
// T2V models (HappyHorse / Wan / Veo)
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – T2V models', () => {
  it('should send prompt + duration + resolved size for HappyHorse T2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-1' }),
    });

    await createAiHubMixVideo(
      {
        model: 'happyhorse-1.0-t2v',
        params: {
          prompt: 'A horse running',
          duration: 5,
          resolution: '1080P',
          aspectRatio: '16:9',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.model).toBe('happyhorse-1.0-t2v');
    expect(body.prompt).toBe('A horse running');
    expect(body.seconds).toBe('5');
    expect(body.size).toBe('1920x1080');
    expect(body.input_reference).toBeUndefined();
    expect(body.extra_body).toBeUndefined();
  });

  it('should send aspectRatio as size when no resolution', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-2' }),
    });

    await createAiHubMixVideo(
      {
        model: 'wan2.7-t2v',
        params: { prompt: 'A sunset', duration: 10, aspectRatio: '9:16' },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.size).toBe('9:16');
  });

  it('should send resolution as size when no aspectRatio', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-3' }),
    });

    await createAiHubMixVideo(
      {
        model: 'veo-3.1-generate-preview',
        params: { prompt: 'A video', duration: 8, resolution: '4k' },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.size).toBe('4k');
  });
});

// ---------------------------------------------------------------------------
// I2V models (single imageUrl → input_reference)
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – I2V models', () => {
  it('should forward imageUrl as input_reference for Wan I2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-4' }),
    });

    await createAiHubMixVideo(
      {
        model: 'wan2.7-i2v',
        params: {
          prompt: 'Animate this',
          duration: 5,
          imageUrl: 'https://example.com/img.jpg',
          resolution: '720P',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.input_reference).toBe('https://example.com/img.jpg');
    // Resolution only → resolved to pixel format with default 16:9
    expect(body.size).toBe('1280x720');
    expect(body.seconds).toBe('5');
  });

  it('should forward imageUrl as input_reference for HappyHorse I2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-hhi2v' }),
    });

    await createAiHubMixVideo(
      {
        model: 'happyhorse-1.0-i2v',
        params: {
          prompt: 'Animate this image',
          duration: 5,
          imageUrl: 'https://example.com/horse.jpg',
          resolution: '1080P',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.model).toBe('happyhorse-1.0-i2v');
    expect(body.input_reference).toBe('https://example.com/horse.jpg');
    // Resolution only → resolved to pixel format with default 16:9
    expect(body.size).toBe('1920x1080');
  });
});

// ---------------------------------------------------------------------------
// R2V models (imageUrls → extra_body.content[])
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – R2V models', () => {
  it('should map imageUrls to extra_body.content for HappyHorse R2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-5' }),
    });

    await createAiHubMixVideo(
      {
        model: 'happyhorse-1.0-r2v',
        params: {
          prompt: 'Reference-based generation',
          duration: 5,
          imageUrls: ['https://a.com/1.jpg', 'https://b.com/2.jpg'],
          aspectRatio: '16:9',
          resolution: '1080P',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.size).toBe('1920x1080');
    expect(body.extra_body.content).toEqual([
      { image_url: { url: 'https://a.com/1.jpg' }, role: 'reference_image', type: 'image_url' },
      { image_url: { url: 'https://b.com/2.jpg' }, role: 'reference_image', type: 'image_url' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Seedance models (extra_body with content, ratio, duration, etc.)
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – Seedance models', () => {
  it('should build extra_body for Seedance T2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-6' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-260128',
        params: {
          prompt: 'A dancing robot',
          duration: 5,
          aspectRatio: '16:9',
          watermark: true,
          generateAudio: true,
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    // Seedance uses top-level seconds (verified against live API)
    expect(body.seconds).toBe('5');
    // size is resolved from resolution + aspectRatio.
    // Only aspectRatio set → size is the ratio label "16:9"
    expect(body.size).toBe('16:9');
    // extra_body should contain ratio, watermark, generate_audio (NOT duration)
    expect(body.extra_body).toEqual({
      ratio: '16:9',
      watermark: true,
      generate_audio: true,
    });
  });

  it('should pass pixel-format size for Seedance with resolution + aspectRatio', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-res' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-fast-260128',
        params: {
          prompt: 'Low-res video',
          duration: 5,
          resolution: '480P',
          aspectRatio: '3:4',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    // Seedance uses top-level size in pixel format (verified against live API)
    expect(body.size).toBe('624x832');
    // Duration uses top-level seconds (not extra_body.duration)
    expect(body.seconds).toBe('5');
    // ratio still goes in extra_body for Seedance-specific controls
    expect(body.extra_body.ratio).toBe('3:4');
    expect(body.extra_body.duration).toBeUndefined();
  });

  it('should build extra_body.content from imageUrls for Seedance I2V/R2V', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-7' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-fast-260128',
        params: {
          prompt: 'Dance with these refs',
          duration: 10,
          imageUrls: ['https://ref.com/a.jpg', 'https://ref.com/b.jpg'],
          aspectRatio: '9:16',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.extra_body.content).toHaveLength(2);
    expect(body.extra_body.ratio).toBe('9:16');
    // Duration uses top-level seconds (verified against live API)
    expect(body.seconds).toBe('10');
    expect(body.extra_body.duration).toBeUndefined();
  });

  it('should include endImageUrl in extra_body.content', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-8' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-260128',
        params: {
          prompt: 'End frame test',
          duration: 5,
          imageUrl: 'https://start.com/img.jpg',
          endImageUrl: 'https://end.com/img.jpg',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    // imageUrl → top-level input_reference
    expect(body.input_reference).toBe('https://start.com/img.jpg');
    // Duration uses top-level seconds
    expect(body.seconds).toBe('5');
    // endImageUrl → extra_body.content
    expect(body.extra_body.content).toEqual([
      { image_url: { url: 'https://end.com/img.jpg' }, role: 'reference_image', type: 'image_url' },
    ]);
  });

  it('should omit extra_body when no Seedance-specific params set', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-9' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-260128',
        params: { prompt: 'Minimal' },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.extra_body).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Veo models
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – Veo models', () => {
  it('should resolve resolution+aspectRatio for Veo', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-10' }),
    });

    await createAiHubMixVideo(
      {
        model: 'veo-3.1-generate-preview',
        params: {
          prompt: 'Google Veo test',
          duration: 8,
          resolution: '720p',
          aspectRatio: '16:9',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.size).toBe('1280x720');
    expect(body.seconds).toBe('8');
  });

  it('should handle 4k resolution', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-11' }),
    });

    await createAiHubMixVideo(
      {
        model: 'veo-3.1-fast-generate-preview',
        params: {
          prompt: '4K video',
          duration: 6,
          resolution: '4k',
          aspectRatio: '16:9',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    // 4k not in RESOLUTION_MAP, falls back to resolution string
    expect(body.size).toBe('4k');
  });

  it('should resolve resolution+aspectRatio for Veo Lite', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-lite' }),
    });

    await createAiHubMixVideo(
      {
        model: 'veo-3.1-lite-generate-preview',
        params: {
          prompt: 'Lite video',
          duration: 4,
          resolution: '1080p',
          aspectRatio: '9:16',
        },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.model).toBe('veo-3.1-lite-generate-preview');
    expect(body.size).toBe('1080x1920');
    expect(body.seconds).toBe('4');
  });
});

// ---------------------------------------------------------------------------
// Seed + Watermark params
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – seed and watermark params', () => {
  it('should forward seed for non-Seedance models', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-seed' }),
    });

    await createAiHubMixVideo(
      {
        model: 'wan2.7-t2v',
        params: { prompt: 'Seeded video', duration: 5, seed: 42 },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.seed).toBe(42);
  });

  it('should forward watermark for non-Seedance models', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-wm' }),
    });

    await createAiHubMixVideo(
      {
        model: 'happyhorse-1.0-t2v',
        params: { prompt: 'Watermarked', duration: 5, watermark: true },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.watermark).toBe(true);
  });

  it('should forward seed inside extra_body for Seedance models', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-seedance-seed' }),
    });

    await createAiHubMixVideo(
      {
        model: 'doubao-seedance-2-0-260128',
        params: { prompt: 'Seedance seeded', duration: 8, seed: 99 },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.extra_body.seed).toBe(99);
  });

  it('should not forward seed when null', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-null-seed' }),
    });

    await createAiHubMixVideo(
      {
        model: 'wan2.7-t2v',
        params: { prompt: 'No seed', duration: 5, seed: null },
      },
      mockOptions,
    );

    const body = getLastBody();
    expect(body.seed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Error scenarios
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – errors', () => {
  it('should throw on HTTP error', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      createAiHubMixVideo({ model: 'wan2.7-t2v', params: { prompt: 'test' } }, mockOptions),
    ).rejects.toThrow('AiHubMix video API error: 401 Unauthorized');
  });

  it('should throw when response missing id', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await expect(
      createAiHubMixVideo({ model: 'wan2.7-t2v', params: { prompt: 'test' } }, mockOptions),
    ).rejects.toThrow('Invalid response: missing id');
  });
});

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------
describe('createAiHubMixVideo – URL', () => {
  it('should POST to {baseURL}/videos', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-url' }),
    });

    await createAiHubMixVideo(
      { model: 'happyhorse-1.0-t2v', params: { prompt: 'test' } },
      mockOptions,
    );

    expect(fetch).toHaveBeenCalledWith('https://aihubmix.com/v1/videos', expect.any(Object));
  });

  it('should use default baseURL when not provided', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'task-default' }),
    });

    await createAiHubMixVideo(
      { model: 'happyhorse-1.0-t2v', params: { prompt: 'test' } },
      { apiKey: 'key', provider: 'aihubmix' },
    );

    expect(fetch).toHaveBeenCalledWith('https://aihubmix.com/v1/videos', expect.any(Object));
  });
});
