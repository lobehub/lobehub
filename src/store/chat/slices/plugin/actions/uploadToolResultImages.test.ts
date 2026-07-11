import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadToolResultImages } from './uploadToolResultImages';

const { uploadBase64FileWithProgress } = vi.hoisted(() => ({
  uploadBase64FileWithProgress: vi.fn(),
}));

vi.mock('@/store/file/store', () => ({
  getFileStoreState: () => ({ uploadBase64FileWithProgress }),
}));

describe('uploadToolResultImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through states without images', async () => {
    const state = { content: 'hello', images: undefined, path: '/tmp/a.txt' };

    expect(await uploadToolResultImages(state)).toBe(state);
    expect(await uploadToolResultImages(undefined)).toBeUndefined();
    expect(uploadBase64FileWithProgress).not.toHaveBeenCalled();
  });

  it('uploads pre-upload entries and rewrites them to durable references', async () => {
    uploadBase64FileWithProgress.mockResolvedValue({
      id: 'file-1',
      url: 'https://files.example.com/cat.png',
    });

    const state = {
      content: '[Image: cat.png]',
      images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }],
      path: '/tmp/cat.png',
    };

    const result = await uploadToolResultImages(state);

    expect(uploadBase64FileWithProgress).toHaveBeenCalledWith('data:image/png;base64,aGVsbG8=');
    // Base64 payload must not survive into the persisted state.
    expect(result?.images).toEqual([
      { fileId: 'file-1', mediaType: 'image/png', url: 'https://files.example.com/cat.png' },
    ]);
    expect(result?.content).toBe('[Image: cat.png]');
  });

  it('keeps already-uploaded entries untouched', async () => {
    const state = {
      images: [{ fileId: 'file-1', mediaType: 'image/png', url: 'https://files.example.com/a' }],
    };

    const result = await uploadToolResultImages(state);

    expect(uploadBase64FileWithProgress).not.toHaveBeenCalled();
    expect(result?.images).toEqual(state.images);
  });

  it('drops the entry (and the images field when empty) on upload failure', async () => {
    uploadBase64FileWithProgress.mockRejectedValue(new Error('no storage'));

    const state = {
      content: '[Image: cat.png]',
      images: [{ data: 'aGVsbG8=', mediaType: 'image/png' }],
    };

    const result = await uploadToolResultImages(state);

    // Degrade: the [Image: …] placeholder in content is the fallback.
    expect(result).toEqual({ content: '[Image: cat.png]' });
  });

  it('drops the entry when the uploader declines (returns undefined)', async () => {
    uploadBase64FileWithProgress.mockResolvedValue(undefined);

    const state = {
      images: [
        { data: 'aGVsbG8=', mediaType: 'image/png' },
        { fileId: 'file-2', mediaType: 'image/jpeg', url: 'https://files.example.com/b' },
      ],
    };

    const result = await uploadToolResultImages(state);

    expect(result?.images).toEqual([
      { fileId: 'file-2', mediaType: 'image/jpeg', url: 'https://files.example.com/b' },
    ]);
  });
});
