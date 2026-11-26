import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VideoGenerationService } from './video';

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(function () {
    return {};
  }),
}));

/**
 * `processVideoForGeneration` downloads `videoUrl` server-side. The download
 * must go through the SSRF policy; a raw fetch would reach intranet and
 * instance metadata endpoints (T-07).
 */
describe('VideoGenerationService SSRF boundary', () => {
  beforeEach(() => {
    vi.stubEnv('SSRF_ALLOW_IP_ADDRESS_LIST', undefined);
    vi.stubEnv('SSRF_ALLOW_PRIVATE_IP_ADDRESS', undefined);
    // A stubbed native fetch keeps the unguarded path deterministic so this
    // suite fails fast if the SSRF guard is ever bypassed.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    'http://169.254.169.254/latest/meta-data/v.mp4',
    'http://127.0.0.1/v.mp4',
    'http://10.0.0.1/v.mp4',
    'http://192.168.1.1/v.mp4',
    'http://[::1]/v.mp4',
  ])('blocks the video download to %s', async (videoUrl) => {
    const service = new VideoGenerationService({} as any, 'user-1');

    await expect(service.processVideoForGeneration(videoUrl)).rejects.toThrow(/SSRF blocked/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
