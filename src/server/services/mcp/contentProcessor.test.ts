import { describe, expect, it, vi } from 'vitest';

// Mock appEnv before importing
vi.mock('@/envs/app', () => ({
  appEnv: { APP_URL: 'https://my-app.example.com' },
}));

import { contentBlocksToString } from './contentProcessor';

describe('contentBlocksToString', () => {
  it('should return empty string for null/undefined', () => {
    expect(contentBlocksToString(null)).toBe('');
    expect(contentBlocksToString(undefined)).toBe('');
  });

  it('should return empty string for empty array', () => {
    expect(contentBlocksToString([])).toBe('');
  });

  it('should extract text from text blocks', () => {
    const result = contentBlocksToString([{ type: 'text', text: 'Hello world' }]);
    expect(result).toBe('Hello world');
  });

  it('should join multiple text blocks with double newline', () => {
    const result = contentBlocksToString([
      { type: 'text', text: 'First' },
      { type: 'text', text: 'Second' },
    ]);
    expect(result).toBe('First\n\nSecond');
  });

  // --- URL resolution tests (Sourcery AI review fix) ---

  it('should NOT double-prefix absolute http URLs for images', () => {
    const result = contentBlocksToString([
      { type: 'image', data: 'https://cdn.example.com/img.png', mimeType: 'image/png' },
    ]);
    expect(result).toBe('![](https://cdn.example.com/img.png)');
    expect(result).not.toContain('https://my-app.example.com/https://');
  });

  it('should NOT double-prefix absolute http URLs for audio', () => {
    const result = contentBlocksToString([
      { type: 'audio', data: 'https://cdn.example.com/audio.mp3', mimeType: 'audio/mp3' },
    ]);
    expect(result).toContain('url="https://cdn.example.com/audio.mp3"');
    expect(result).not.toContain('https://my-app.example.com/https://');
  });

  it('should prefix relative paths with APP_URL for images', () => {
    const result = contentBlocksToString([
      { type: 'image', data: '/f/abc123.png', mimeType: 'image/png' },
    ]);
    expect(result).toBe('![](https://my-app.example.com/f/abc123.png)');
  });

  it('should prefix relative paths with APP_URL for audio', () => {
    const result = contentBlocksToString([
      { type: 'audio', data: '/f/audio123.mp3', mimeType: 'audio/mp3' },
    ]);
    expect(result).toContain('url="https://my-app.example.com/f/audio123.mp3"');
  });

  it('should NOT treat paths starting with "http" (no "://") as absolute URLs', () => {
    // Edge case from Sourcery review: "http-assets/foo.png" should be treated as relative
    const result = contentBlocksToString([
      { type: 'image', data: 'http-assets/foo.png', mimeType: 'image/png' },
    ]);
    expect(result).toBe('![](https://my-app.example.com/http-assets/foo.png)');
  });

  it('should handle mixed content blocks', () => {
    const result = contentBlocksToString([
      { type: 'text', text: 'Generated image:' },
      { type: 'image', data: 'https://cdn.example.com/result.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(result).toBe('Generated image:\n\n![](https://cdn.example.com/result.jpg)');
  });

  it('should skip unknown block types', () => {
    const result = contentBlocksToString([
      { type: 'text', text: 'Hello' },
      { type: 'unknown_type' } as any,
    ]);
    expect(result).toBe('Hello');
  });

  it('should handle resource blocks', () => {
    const resource = { uri: 'file:///tmp/data.json', text: '{}' };
    const result = contentBlocksToString([
      { type: 'resource', resource } as any,
    ]);
    expect(result).toContain('resource');
    expect(result).toContain(JSON.stringify(resource));
  });
});
