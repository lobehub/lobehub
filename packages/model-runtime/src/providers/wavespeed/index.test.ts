// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LobeWaveSpeedAI } from './index';

vi.mock('./createImage', () => ({ createWaveSpeedImage: vi.fn() }));
vi.mock('./createVideo', () => ({
  createWaveSpeedVideo: vi.fn(),
  pollWaveSpeedVideoStatus: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('LobeWaveSpeedAI', () => {
  describe('init', () => {
    it('should initialize with an API key', () => {
      expect(new LobeWaveSpeedAI({ apiKey: 'test' })).toBeInstanceOf(LobeWaveSpeedAI);
    });

    it('should accept a custom baseURL', () => {
      const instance = new LobeWaveSpeedAI({
        apiKey: 'test',
        baseURL: 'https://proxy.example.com',
      });

      expect(instance.baseURL).toBe('https://proxy.example.com');
    });

    it('should throw when the API key is missing', () => {
      expect(() => new LobeWaveSpeedAI({})).toThrow();
      expect(() => new LobeWaveSpeedAI({ apiKey: undefined })).toThrow();
    });
  });

  describe('createImage', () => {
    it('should delegate to createWaveSpeedImage with the provider options', async () => {
      const { createWaveSpeedImage } = await import('./createImage');
      vi.mocked(createWaveSpeedImage).mockResolvedValue({ imageUrl: 'https://cdn/a.png' });

      const instance = new LobeWaveSpeedAI({ apiKey: 'test' });
      const payload = { model: 'm', params: { prompt: 'x' } as any };

      await expect(instance.createImage(payload)).resolves.toEqual({
        imageUrl: 'https://cdn/a.png',
      });
      expect(createWaveSpeedImage).toHaveBeenCalledWith(payload, {
        apiKey: 'test',
        baseURL: undefined,
        provider: 'wavespeed',
      });
    });
  });

  describe('createVideo', () => {
    it('should delegate to createWaveSpeedVideo', async () => {
      const { createWaveSpeedVideo } = await import('./createVideo');
      vi.mocked(createWaveSpeedVideo).mockResolvedValue({ inferenceId: 'm::pred-1' });

      const instance = new LobeWaveSpeedAI({ apiKey: 'test' });
      const payload = { model: 'm', params: { prompt: 'x' } as any };

      await expect(instance.createVideo(payload)).resolves.toEqual({ inferenceId: 'm::pred-1' });
      expect(createWaveSpeedVideo).toHaveBeenCalledWith(payload, {
        apiKey: 'test',
        baseURL: undefined,
        provider: 'wavespeed',
      });
    });
  });

  describe('handlePollVideoStatus', () => {
    it('should delegate to pollWaveSpeedVideoStatus', async () => {
      const { pollWaveSpeedVideoStatus } = await import('./createVideo');
      vi.mocked(pollWaveSpeedVideoStatus).mockResolvedValue({
        status: 'success',
        videoUrl: 'https://cdn/v.mp4',
      });

      const instance = new LobeWaveSpeedAI({ apiKey: 'test' });

      await expect(instance.handlePollVideoStatus('m::pred-1')).resolves.toEqual({
        status: 'success',
        videoUrl: 'https://cdn/v.mp4',
      });
      expect(pollWaveSpeedVideoStatus).toHaveBeenCalledWith('m::pred-1', {
        apiKey: 'test',
        baseURL: undefined,
        provider: 'wavespeed',
      });
    });
  });
});
