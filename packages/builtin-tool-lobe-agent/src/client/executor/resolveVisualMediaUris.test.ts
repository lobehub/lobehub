import { imageUrlToBase64 } from '@lobechat/utils/imageToBase64';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { VisualFileItem } from '../../visualMedia';
import {
  resolveClientVisualMediaPayloadItems,
  resolveClientVisualMediaUris,
} from './resolveVisualMediaUris';

vi.mock('@lobechat/utils/imageToBase64', () => ({
  imageUrlToBase64: vi.fn(),
}));

const createVisualItem = (item: Partial<VisualFileItem>): VisualFileItem => ({
  description: 'test.png',
  localRef: 'image_1',
  name: 'test.png',
  ref: 'msg_1.image_1',
  type: 'image',
  uri: 'https://example.com/test.png',
  ...item,
});

describe('resolveClientVisualMediaUris', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should convert desktop local visual media URLs to data URLs', async () => {
    vi.mocked(imageUrlToBase64)
      .mockResolvedValueOnce({
        base64: 'image-base64',
        mimeType: 'image/png',
      })
      .mockResolvedValueOnce({
        base64: 'video-base64',
        mimeType: 'video/mp4',
      });

    const localImage = createVisualItem({
      name: 'local.png',
      uri: 'http://127.0.0.1:3210/uploads/local.png',
    });
    const localVideo = createVisualItem({
      name: 'local.mp4',
      type: 'video',
      uri: 'http://127.0.0.1:3210/uploads/local.mp4',
    });
    const remoteImage = createVisualItem({
      name: 'remote.png',
      uri: 'https://example.com/remote.png',
    });
    const dataImage = createVisualItem({
      name: 'inline.png',
      uri: 'data:image/png;base64,inline-base64',
    });

    const result = await resolveClientVisualMediaUris([
      localImage,
      localVideo,
      remoteImage,
      dataImage,
    ]);

    expect(result).toEqual([
      {
        ...localImage,
        uri: 'data:image/png;base64,image-base64',
      },
      {
        ...localVideo,
        uri: 'data:video/mp4;base64,video-base64',
      },
      remoteImage,
      dataImage,
    ]);
    expect(imageUrlToBase64).toHaveBeenCalledTimes(2);
    expect(imageUrlToBase64).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:3210/uploads/local.png');
    expect(imageUrlToBase64).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:3210/uploads/local.mp4');
  });

  it('should reject desktop local URLs when fetched MIME type does not match the item type', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'not-found',
      mimeType: 'text/plain',
    });

    const localImage = createVisualItem({
      name: 'missing.png',
      uri: 'http://127.0.0.1:3210/uploads/missing.png',
    });

    await expect(resolveClientVisualMediaUris([localImage])).rejects.toThrow(
      'Unable to read image attachment "missing.png": expected image/* MIME type, received text/plain.',
    );
  });

  it('should reject desktop local video URLs when fetched MIME type is an image', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'poster',
      mimeType: 'image/png',
    });

    const localVideo = createVisualItem({
      name: 'clip.mp4',
      type: 'video',
      uri: 'http://127.0.0.1:3210/uploads/clip.mp4',
    });

    await expect(resolveClientVisualMediaUris([localVideo])).rejects.toThrow(
      'Unable to read video attachment "clip.mp4": expected video/* MIME type, received image/png.',
    );
  });

  it('should only convert attachment refs when building visual media payload items', async () => {
    vi.mocked(imageUrlToBase64).mockResolvedValue({
      base64: 'attachment-base64',
      mimeType: 'image/png',
    });

    const localAttachment = createVisualItem({
      name: 'attachment.png',
      uri: 'http://127.0.0.1:3210/uploads/attachment.png',
    });
    const directLocalUrl = createVisualItem({
      localRef: 'url_1',
      name: 'direct.png',
      ref: 'url_1',
      uri: 'http://127.0.0.1:3210/private/direct.png',
    });

    const result = await resolveClientVisualMediaPayloadItems({
      selectedRefs: [localAttachment],
      selectedUrls: [directLocalUrl],
    });

    expect(result).toEqual([
      {
        ...localAttachment,
        uri: 'data:image/png;base64,attachment-base64',
      },
      directLocalUrl,
    ]);
    expect(imageUrlToBase64).toHaveBeenCalledTimes(1);
    expect(imageUrlToBase64).toHaveBeenCalledWith('http://127.0.0.1:3210/uploads/attachment.png');
  });
});
