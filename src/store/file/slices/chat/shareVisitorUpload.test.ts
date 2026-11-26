import { describe, expect, it, vi } from 'vitest';

import { shareChatService } from '@/services/shareChat';
import { uploadService } from '@/services/upload';

import { uploadShareVisitorFile } from './shareVisitorUpload';

vi.mock('@/services/shareChat', () => ({
  shareChatService: {
    createFile: vi.fn(async () => ({ id: 'file-1', url: 'https://s3/file-1' })),
    createUploadUrl: vi.fn(async () => ({ pathname: 'share/file-1', url: 'https://s3/put' })),
  },
}));
vi.mock('@/services/upload', () => ({
  uploadService: { uploadToPresignedUrl: vi.fn(async () => undefined) },
}));
vi.mock('@/utils/client/imageDimensions', () => ({
  getImageDimensions: vi.fn(async () => undefined),
}));
vi.mock('@/utils/client/audioDuration', () => ({ getAudioDuration: vi.fn(async () => 1200) }));
vi.mock('../upload/action', () => ({
  normalizeUploadedFileType: vi.fn(async (file: File) => ({ file })),
}));

describe('uploadShareVisitorFile', () => {
  it('reports the type the file was stored with on success', async () => {
    // The browser calls an .m4a `video/mp4`; the upload stores it as audio.
    const file = new File(['x'], 'voice.m4a', { type: 'video/mp4' });
    const onStatusUpdate = vi.fn();

    await uploadShareVisitorFile({ file, onStatusUpdate, shareId: 'share-1', uploadId: 'chip-1' });

    const storedType = vi.mocked(shareChatService.createFile).mock.calls[0][0].fileType;
    expect(storedType).toMatch(/^audio\//);
    expect(uploadService.uploadToPresignedUrl).toHaveBeenCalled();
    expect(onStatusUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: 'chip-1',
        value: expect.objectContaining({ fileType: storedType, status: 'success' }),
      }),
    );
  });
});
