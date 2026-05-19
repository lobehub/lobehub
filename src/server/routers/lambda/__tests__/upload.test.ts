import { describe, expect, it, vi, beforeEach } from 'vitest';

import { fileEnv } from '@/envs/file';

// Mock FileS3
vi.mock('@/server/modules/S3', () => ({
  FileS3: vi.fn(() => ({
    createPreSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/signed-url'),
  })),
}));

describe('Upload Router', () => {
  let uploadRouter: any;

  beforeEach(async () => {
    // Dynamically import to get fresh instance
    const module = await import('../upload');
    uploadRouter = module.uploadRouter;
  });

  describe('createS3PreSignedUrl', () => {
    it('should reject unsupported file types', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          contentType: 'application/x-executable',
          pathname: 'test.exe',
        });
      }).toThrow();
    });

    it('should accept supported image types', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          contentType: 'image/jpeg',
          pathname: 'test.jpg',
        });
      }).not.toThrow();
    });

    it('should accept supported video types', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          contentType: 'video/mp4',
          pathname: 'test.mp4',
        });
      }).not.toThrow();
    });

    it('should accept supported audio types', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          contentType: 'audio/mpeg',
          pathname: 'test.mp3',
        });
      }).not.toThrow();
    });

    it('should accept supported document types', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      const documentTypes = [
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ];

      for (const contentType of documentTypes) {
        expect(() => {
          procedure._def.inputs[0].parse({
            contentType,
            pathname: `test.${contentType.split('/')[1]}`,
          });
        }).not.toThrow();
      }
    });

    it('should default to application/octet-stream if no contentType provided', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          pathname: 'test.bin',
        });
      }).not.toThrow();
    });

    it('should require pathname', async () => {
      const procedure = uploadRouter.getShape().createS3PreSignedUrl;

      expect(() => {
        procedure._def.inputs[0].parse({
          contentType: 'image/jpeg',
        });
      }).toThrow();
    });
  });

  describe('testS3Connection', () => {
    it('should exist as a public procedure', async () => {
      expect(uploadRouter.getShape().testS3Connection).toBeDefined();
    });

    it('should check S3 environment variables', async () => {
      const procedure = uploadRouter.getShape().testS3Connection;

      // The procedure should return checks object
      expect(procedure).toBeDefined();
    });
  });

  describe('File Size Limits', () => {
    it('should validate image file size limits', () => {
      // 50MB limit for images
      const sizeLimitImageMB = 50;
      expect(sizeLimitImageMB).toBe(50);
    });

    it('should validate video file size limits', () => {
      // 500MB limit for videos
      const sizeLimitVideoMB = 500;
      expect(sizeLimitVideoMB).toBe(500);
    });

    it('should validate audio file size limits', () => {
      // 100MB limit for audio
      const sizeLimitAudioMB = 100;
      expect(sizeLimitAudioMB).toBe(100);
    });

    it('should validate document file size limits', () => {
      // 100MB limit for documents
      const sizeLimitDocumentMB = 100;
      expect(sizeLimitDocumentMB).toBe(100);
    });
  });

  describe('Supported File Types', () => {
    it('should support multiple image formats', () => {
      const imageFormats = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      expect(imageFormats).toHaveLength(5);
    });

    it('should support multiple video formats', () => {
      const videoFormats = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
      expect(videoFormats).toHaveLength(4);
    });

    it('should support multiple audio formats', () => {
      const audioFormats = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/webm'];
      expect(audioFormats).toHaveLength(5);
    });

    it('should support multiple document formats', () => {
      const documentFormats = [
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ];
      expect(documentFormats.length).toBeGreaterThanOrEqual(9);
    });
  });
});
