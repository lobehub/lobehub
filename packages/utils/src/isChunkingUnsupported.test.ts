import { describe, expect, it } from 'vitest';

import { isChunkingUnsupported } from './isChunkingUnsupported';

describe('isChunkingUnsupported', () => {
  it('should return true for image file types', () => {
    expect(isChunkingUnsupported('image/jpeg')).toBe(true);
    expect(isChunkingUnsupported('image/png')).toBe(true);
    expect(isChunkingUnsupported('image/gif')).toBe(true);
    expect(isChunkingUnsupported('image/svg+xml')).toBe(true);
  });

  it('should return true for video file types', () => {
    expect(isChunkingUnsupported('video/mp4')).toBe(true);
    expect(isChunkingUnsupported('video/quicktime')).toBe(true);
    expect(isChunkingUnsupported('video/x-msvideo')).toBe(true);
    expect(isChunkingUnsupported('video/webm')).toBe(true);
  });

  it('should return true for audio file types', () => {
    expect(isChunkingUnsupported('audio/mpeg')).toBe(true);
    expect(isChunkingUnsupported('audio/wav')).toBe(true);
    expect(isChunkingUnsupported('audio/ogg')).toBe(true);
    expect(isChunkingUnsupported('audio/midi')).toBe(true);
  });

  it('should return false for other file types', () => {
    expect(isChunkingUnsupported('text/plain')).toBe(false);
    expect(isChunkingUnsupported('application/pdf')).toBe(false);
    expect(isChunkingUnsupported('application/json')).toBe(false);
    expect(isChunkingUnsupported('application/xml')).toBe(false);
  });

  it('should handle empty string input', () => {
    expect(isChunkingUnsupported('')).toBe(false);
  });

  it('should handle non-standard file types', () => {
    expect(isChunkingUnsupported('image-x-custom')).toBe(true);
    expect(isChunkingUnsupported('video-custom')).toBe(true);
    expect(isChunkingUnsupported('audio-special')).toBe(true);
  });
});
