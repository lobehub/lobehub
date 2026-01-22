import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolCallContent } from '@/libs/mcp';
import { FileService } from '@/server/services/file';

import { contentBlocksToString, processContentBlocks } from './contentProcessor';

// Mock dependencies
vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
  },
}));

vi.mock('@/envs/file', () => ({
  fileEnv: {
    NEXT_PUBLIC_S3_FILE_PATH: 'files',
  },
}));

vi.mock('@/utils/uuid', () => ({
  nanoid: vi.fn(() => 'mock-uuid-1234'),
}));

describe('contentProcessor', () => {
  describe('contentBlocksToString', () => {
    it('should return empty string for null input', () => {
      const result = contentBlocksToString(null);
      expect(result).toBe('');
    });

    it('should return empty string for undefined input', () => {
      const result = contentBlocksToString(undefined);
      expect(result).toBe('');
    });

    it('should return empty string for empty array', () => {
      const result = contentBlocksToString([]);
      expect(result).toBe('');
    });

    it('should extract text from single text block', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: 'Hello World',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('Hello World');
    });

    it('should format single image block with markdown', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: '/path/to/image.png',
          mimeType: 'image/png',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('![](https://example.com/path/to/image.png)');
    });

    it('should format single audio block with resource XML', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: '/path/to/audio.mp3',
          mimeType: 'audio/mp3',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('<resource type="audio" url="https://example.com/path/to/audio.mp3" />');
    });

    it('should format resource block with JSON serialization', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: {
            uri: 'https://example.com/resource',
            text: 'Resource content',
          },
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe(
        '<resource type="resource">{"uri":"https://example.com/resource","text":"Resource content"}</resource>}',
      );
    });

    it('should skip unknown block types', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'resource_link',
          uri: 'https://example.com',
          name: 'Example',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('');
    });

    it('should join multiple text blocks with double newlines', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: 'First line',
        },
        {
          type: 'text',
          text: 'Second line',
        },
        {
          type: 'text',
          text: 'Third line',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('First line\n\nSecond line\n\nThird line');
    });

    it('should handle mixed content types', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: 'Here is an image:',
        },
        {
          type: 'image',
          data: '/images/photo.jpg',
          mimeType: 'image/jpeg',
        },
        {
          type: 'text',
          text: 'And some audio:',
        },
        {
          type: 'audio',
          data: '/audio/sound.mp3',
          mimeType: 'audio/mp3',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe(
        'Here is an image:\n\n![](https://example.com/images/photo.jpg)\n\nAnd some audio:\n\n<resource type="audio" url="https://example.com/audio/sound.mp3" />',
      );
    });

    it('should filter out empty strings from unknown types', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: 'Valid text',
        },
        {
          type: 'resource_link',
          uri: 'https://example.com',
          name: 'Link',
        },
        {
          type: 'text',
          text: 'More text',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('Valid text\n\nMore text');
    });

    it('should handle empty text content', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: '',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('');
    });

    it('should join APP_URL with relative image path', () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: '/relative/path/image.png',
          mimeType: 'image/png',
        },
      ];

      const result = contentBlocksToString(blocks);
      expect(result).toBe('![](https://example.com/relative/path/image.png)');
    });
  });

  describe('processContentBlocks', () => {
    let mockFileService: FileService;

    beforeEach(() => {
      vi.clearAllMocks();

      // Mock FileService
      mockFileService = {
        uploadBase64: vi.fn(),
      } as any;
    });

    it('should pass through text blocks unchanged', async () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'text',
          text: 'Hello World',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result).toEqual(blocks);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should upload image and replace data with proxy URL', async () => {
      const mockUrl = 'https://cdn.example.com/uploaded-image.png';
      (mockFileService.uploadBase64 as any).mockResolvedValue({ url: mockUrl });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'base64ImageData',
          mimeType: 'image/png',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledTimes(1);
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64ImageData',
        expect.stringMatching(/^files\/mcp\/images\/\d{4}-\d{2}-\d{2}\/mock-uuid-1234\.png$/),
      );
      expect(result).toEqual([
        {
          type: 'image',
          data: mockUrl,
          mimeType: 'image/png',
        },
      ]);
    });

    it('should upload audio and replace data with proxy URL', async () => {
      const mockUrl = 'https://cdn.example.com/uploaded-audio.mp3';
      (mockFileService.uploadBase64 as any).mockResolvedValue({ url: mockUrl });

      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: 'base64AudioData',
          mimeType: 'audio/mp3',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledTimes(1);
      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64AudioData',
        expect.stringMatching(/^files\/mcp\/audio\/\d{4}-\d{2}-\d{2}\/mock-uuid-1234\.mp3$/),
      );
      expect(result).toEqual([
        {
          type: 'audio',
          data: mockUrl,
          mimeType: 'audio/mp3',
        },
      ]);
    });

    it('should extract correct file extension from mimeType for images', async () => {
      (mockFileService.uploadBase64 as any).mockResolvedValue({
        url: 'https://cdn.example.com/image.jpg',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'base64Data',
          mimeType: 'image/jpeg',
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64Data',
        expect.stringMatching(/\.jpeg$/),
      );
    });

    it('should use default png extension when mimeType format is invalid', async () => {
      (mockFileService.uploadBase64 as any).mockResolvedValue({
        url: 'https://cdn.example.com/image.png',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'base64Data',
          mimeType: 'invalid-mime',
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64Data',
        expect.stringMatching(/\.png$/),
      );
    });

    it('should use default mp3 extension when audio mimeType format is invalid', async () => {
      (mockFileService.uploadBase64 as any).mockResolvedValue({
        url: 'https://cdn.example.com/audio.mp3',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: 'base64Data',
          mimeType: 'invalid-audio',
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64Data',
        expect.stringMatching(/\.mp3$/),
      );
    });

    it('should process multiple blocks in parallel', async () => {
      const mockImageUrl = 'https://cdn.example.com/image.png';
      const mockAudioUrl = 'https://cdn.example.com/audio.mp3';

      (mockFileService.uploadBase64 as any)
        .mockResolvedValueOnce({ url: mockImageUrl })
        .mockResolvedValueOnce({ url: mockAudioUrl });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'imageData',
          mimeType: 'image/png',
        },
        {
          type: 'text',
          text: 'Some text',
        },
        {
          type: 'audio',
          data: 'audioData',
          mimeType: 'audio/mp3',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledTimes(2);
      expect(result).toEqual([
        {
          type: 'image',
          data: mockImageUrl,
          mimeType: 'image/png',
        },
        {
          type: 'text',
          text: 'Some text',
        },
        {
          type: 'audio',
          data: mockAudioUrl,
          mimeType: 'audio/mp3',
        },
      ]);
    });

    it('should pass through resource blocks unchanged', async () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'resource',
          resource: {
            uri: 'https://example.com/resource',
            text: 'Resource content',
          },
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result).toEqual(blocks);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should pass through resource_link blocks unchanged', async () => {
      const blocks: ToolCallContent[] = [
        {
          type: 'resource_link',
          uri: 'https://example.com',
          name: 'Example Link',
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result).toEqual(blocks);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should preserve _meta property on blocks', async () => {
      const mockUrl = 'https://cdn.example.com/image.png';
      (mockFileService.uploadBase64 as any).mockResolvedValue({ url: mockUrl });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'base64Data',
          mimeType: 'image/png',
          _meta: { customField: 'value' },
        },
      ];

      const result = await processContentBlocks(blocks, mockFileService);

      expect(result[0]).toHaveProperty('_meta');
      expect((result[0] as any)._meta).toEqual({ customField: 'value' });
    });

    it('should handle empty blocks array', async () => {
      const result = await processContentBlocks([], mockFileService);

      expect(result).toEqual([]);
      expect(mockFileService.uploadBase64).not.toHaveBeenCalled();
    });

    it('should generate date-based pathname for images', async () => {
      const mockDate = new Date('2025-12-10T10:00:00Z');
      vi.setSystemTime(mockDate);

      (mockFileService.uploadBase64 as any).mockResolvedValue({
        url: 'https://cdn.example.com/image.png',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'image',
          data: 'base64Data',
          mimeType: 'image/png',
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64Data',
        'files/mcp/images/2025-12-10/mock-uuid-1234.png',
      );

      vi.useRealTimers();
    });

    it('should generate date-based pathname for audio', async () => {
      const mockDate = new Date('2025-12-10T10:00:00Z');
      vi.setSystemTime(mockDate);

      (mockFileService.uploadBase64 as any).mockResolvedValue({
        url: 'https://cdn.example.com/audio.mp3',
      });

      const blocks: ToolCallContent[] = [
        {
          type: 'audio',
          data: 'base64Data',
          mimeType: 'audio/mp3',
        },
      ];

      await processContentBlocks(blocks, mockFileService);

      expect(mockFileService.uploadBase64).toHaveBeenCalledWith(
        'base64Data',
        'files/mcp/audio/2025-12-10/mock-uuid-1234.mp3',
      );

      vi.useRealTimers();
    });
  });
});
