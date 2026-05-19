import type { UIChatMessage, UploadFileItem } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  estimatePendingUploadTokenBuckets,
  estimateSentMessageAttachmentTokenBuckets,
  isTextLikeUploadFile,
} from '../attachmentTokenBuckets';

const mkMsg = (m: Partial<UIChatMessage> & { role: UIChatMessage['role'] }): UIChatMessage =>
  ({
    content: '',
    createdAt: 0,
    id: 'm',
    updatedAt: 0,
    ...m,
  }) as UIChatMessage;

const mkUploadFile = ({
  id,
  name,
  size,
  type,
}: {
  id: string;
  name: string;
  size: number;
  type: string;
}): UploadFileItem => ({
  file: { name, size, type } as File,
  fileUrl: `https://example.com/${name}`,
  id,
  status: 'success',
});

describe('attachment token buckets', () => {
  it('estimates persisted file context and visual input buckets', () => {
    const result = estimateSentMessageAttachmentTokenBuckets(
      [
        mkMsg({
          fileList: [
            {
              content: 'parsed text',
              fileType: 'text/plain',
              id: 'file-id',
              name: 'note.txt',
              size: 11,
              url: 'https://example.com/note.txt',
            },
          ],
          imageList: [{ alt: 'image.png', id: 'image-id', url: 'https://example.com/image.png' }],
          role: 'user',
          videoList: [{ alt: 'video.mp4', id: 'video-id', url: 'https://example.com/video.mp4' }],
        }),
      ],
      { canUseVideo: true, canUseVision: true },
    );

    expect(result.textTokens).toBeGreaterThan(0);
    expect(result.imageTokens).toBe(1000);
    expect(result.videoTokens).toBe(1000);
  });

  it('keeps file context but skips visual buckets when the model cannot consume them', () => {
    const result = estimateSentMessageAttachmentTokenBuckets(
      [
        mkMsg({
          imageList: [{ alt: 'image.png', id: 'image-id', url: 'https://example.com/image.png' }],
          role: 'user',
          videoList: [{ alt: 'video.mp4', id: 'video-id', url: 'https://example.com/video.mp4' }],
        }),
      ],
      { canUseVideo: false, canUseVision: false },
    );

    expect(result.textTokens).toBeGreaterThan(0);
    expect(result.imageTokens).toBe(0);
    expect(result.videoTokens).toBe(0);
  });

  it('estimates pending upload buckets with text fallback and loaded text content', () => {
    const files = [
      mkUploadFile({ id: 'text-file', name: 'note.txt', size: 40, type: 'text/plain' }),
      mkUploadFile({ id: 'image-file', name: 'image.png', size: 100, type: 'image/png' }),
      mkUploadFile({ id: 'video-file', name: 'video.mp4', size: 200, type: 'video/mp4' }),
    ];

    const fallbackResult = estimatePendingUploadTokenBuckets(
      files,
      { canUseVideo: true, canUseVision: true },
      {},
    );
    const loadedResult = estimatePendingUploadTokenBuckets(
      files,
      { canUseVideo: true, canUseVision: true },
      { 'text-file': 'loaded text content' },
    );

    expect(fallbackResult.textTokens).toBeGreaterThanOrEqual(10);
    expect(loadedResult.textTokens).toBeGreaterThan(0);
    expect(fallbackResult.imageTokens).toBe(1000);
    expect(fallbackResult.videoTokens).toBe(1000);
    expect(loadedResult.imageTokens).toBe(1000);
    expect(loadedResult.videoTokens).toBe(1000);
  });

  it('detects text-like upload files by mime type and extension', () => {
    expect(
      isTextLikeUploadFile(
        mkUploadFile({ id: 'json', name: 'data.bin', size: 1, type: 'application/json' }),
      ),
    ).toBe(true);
    expect(
      isTextLikeUploadFile(
        mkUploadFile({
          id: 'markdown',
          name: 'README.md',
          size: 1,
          type: 'application/octet-stream',
        }),
      ),
    ).toBe(true);
    expect(
      isTextLikeUploadFile(
        mkUploadFile({
          id: 'typescript',
          name: 'app.ts',
          size: 1,
          type: 'application/octet-stream',
        }),
      ),
    ).toBe(true);
    expect(
      isTextLikeUploadFile(
        mkUploadFile({ id: 'pdf', name: 'document.pdf', size: 1, type: 'application/pdf' }),
      ),
    ).toBe(false);
  });
});
