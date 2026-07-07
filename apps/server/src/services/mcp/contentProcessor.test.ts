import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolCallContent } from '@/libs/mcp';

import { contentBlocksToString, processContentBlocks } from './contentProcessor';

describe('contentProcessor', () => {
  describe('contentBlocksToString', () => {
    it('should return empty string for null input', () => {
      expect(contentBlocksToString(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(contentBlocksToString(undefined)).toBe('');
    });

    it('should return empty string for empty array', () => {
      expect(contentBlocksToString([])).toBe('');
    });

    it('should convert text content to string', () => {
      const blocks: ToolCallContent[] = [{ type: 'text', text: 'hello world' }];
      expect(contentBlocksToString(blocks)).toBe('hello world');
    });

    it('should convert image content with full URL without double prefix', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'https://example.com/f/abc-123',
          mimeType: 'image/png',
        },
      ];
      const result = contentBlocksToString(blocks);
      expect(result).toBe('![](https://example.com/f/abc-123)');
      // Ensure no double URL prefix
      expect(result).not.toContain('https://example.com/https://example.com');
    });

    it('should convert audio content with full URL without double prefix', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: 'https://example.com/f/audio-123',
          mimeType: 'audio/mp3',
        },
      ];
      const result = contentBlocksToString(blocks);
      expect(result).toBe('<resource type="audio" url="https://example.com/f/audio-123" />');
      expect(result).not.toContain('https://example.com/https://example.com');
    });

    it('should join multiple content blocks with double newlines', () => {
      const blocks: ToolCallContent[] = [
        { type: 'text', text: 'Description:' },
        { type: 'image', data: 'https://example.com/f/img-1', mimeType: 'image/png' },
        { type: 'text', text: 'End.' },
      ];
      const result = contentBlocksToString(blocks);
      expect(result).toBe('Description:\n\n![](https://example.com/f/img-1)\n\nEnd.');
    });

    it('should handle resource content', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: { uri: 'file:///test.txt', text: 'content', mimeType: 'text/plain' },
        } as ToolCallContent,
      ];
      const result = contentBlocksToString(blocks);
      expect(result).toBe(
        '<resource type="resource">{"uri":"file:///test.txt","text":"content","mimeType":"text/plain"}</resource>',
      );
    });

    it('should skip unknown content types', () => {
      const blocks = [{ type: 'unknown', data: 'test' }] as unknown as ToolCallContent[];
      expect(contentBlocksToString(blocks)).toBe('');
    });
  });

  describe('processContentBlocks', () => {
    const mockFileService = {
      uploadBase64: vi.fn(),
    } as any;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should upload image and replace base64 data with URL', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://example.com/f/uploaded-img',
        fileId: 'file-1',
        key: 'mcp/images/2025-01-01/abc.png',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUg==',
          mimeType: 'image/png',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result[0].type).toBe('image');
      expect((result[0] as any).data).toBe('https://example.com/f/uploaded-img');
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'iVBORw0KGgoAAAANSUhEUg==',
        expect.stringContaining('mcp/images/'),
        { fileType: 'image/png' },
      );
    });

    it('should upload audio and replace base64 data with URL', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://example.com/f/uploaded-audio',
        fileId: 'file-2',
        key: 'mcp/audio/2025-01-01/abc.mp3',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: 'base64audiodata==',
          mimeType: 'audio/mp3',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result[0].type).toBe('audio');
      expect((result[0] as any).data).toBe('https://example.com/f/uploaded-audio');
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64audiodata==',
        expect.stringContaining('mcp/audio/'),
        { fileType: 'audio/mp3' },
      );
    });

    it('should convert resource image blobs to uploaded image content', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://example.com/f/resource-image',
        fileId: 'file-3',
        key: 'mcp/images/2025-01-01/abc.png',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: {
            blob: 'resourceImageBase64==',
            mimeType: 'image/png',
            uri: 'file:///screenshot.png',
          },
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result[0]).toEqual({
        data: 'https://example.com/f/resource-image',
        mimeType: 'image/png',
        type: 'image',
      });
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'resourceImageBase64==',
        expect.stringMatching(/mcp\/images\/.*\.png$/),
        { fileType: 'image/png' },
      );
    });

    it('should convert resource audio blobs to uploaded audio content', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://example.com/f/resource-audio',
        fileId: 'file-4',
        key: 'mcp/audio/2025-01-01/abc.mp3',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: {
            blob: 'resourceAudioBase64==',
            mimeType: 'audio/mpeg',
            uri: 'file:///voice.mp3',
          },
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result[0]).toEqual({
        data: 'https://example.com/f/resource-audio',
        mimeType: 'audio/mpeg',
        type: 'audio',
      });
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'resourceAudioBase64==',
        expect.stringMatching(/mcp\/audio\/.*\.mp3$/),
        { fileType: 'audio/mpeg' },
      );
    });

    it('should use safe file extensions for structured MIME types', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://example.com/f/resource-svg',
        fileId: 'file-5',
        key: 'mcp/images/2025-01-01/abc.svg',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: {
            blob: 'resourceSvgBase64==',
            mimeType: 'image/svg+xml',
            uri: 'file:///diagram.svg',
          },
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'resourceSvgBase64==',
        expect.stringMatching(/mcp\/images\/.*\.svg$/),
        { fileType: 'image/svg+xml' },
      );
    });

    it('should pass through non-media resource content unchanged', async () => {
      const block = {
        type: 'resource',
        resource: { uri: 'file:///test.txt', text: 'content', mimeType: 'text/plain' },
      } as ToolCallContent;

      const result = await processContentBlocks([block], mockFileService);

      expect(result[0]).toBe(block);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should pass through malformed resource content unchanged', async () => {
      const block = { type: 'resource' } as ToolCallContent;

      const result = await processContentBlocks([block], mockFileService);

      expect(result[0]).toBe(block);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should pass through text content unchanged', async () => {
      const blocks: ToolCallContent[] = [{ type: 'text', text: 'hello' }];
      const result = await processContentBlocks(blocks, mockFileService);
      expect(result[0]).toEqual({ type: 'text', text: 'hello' });
    });

    it('should produce correct string when combined with contentBlocksToString', async () => {
      mockFileService.uploadBase64.mockResolvedValue({
        url: 'https://myapp.com/f/img-uuid',
        fileId: 'file-3',
        key: 'mcp/images/2025-01-01/xyz.png',
      });

      const blocks: ToolCallContent[] = [
        { type: 'text', text: 'Here is the screenshot:' },
        { type: 'image', data: 'base64data==', mimeType: 'image/png' },
      ];

      const processed = await processContentBlocks(blocks, mockFileService);
      const str = contentBlocksToString(processed);

      expect(str).toBe('Here is the screenshot:\n\n![](https://myapp.com/f/img-uuid)');
      // The critical assertion: no double URL prefix
      expect(str).not.toContain('https://myapp.com/https://myapp.com');
    });
  });
});
