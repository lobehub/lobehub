import { describe, expect, it } from 'vitest';

import type { FileUploadStatus } from '@/types/files/upload';

import { getUploadChipSize, getUploadChipState } from './utils';

const uploadState = (progress: number) => ({ progress, restTime: 0, speed: 0 });

describe('getUploadChipState', () => {
  it.each(['pending', 'processing'] as const)(
    'shows an indeterminate indicator for %s',
    (status) => {
      expect(getUploadChipState({ status, uploadState: uploadState(100) })).toMatchObject({
        busy: true,
        canPreview: false,
        canRetry: false,
        indicator: 'loading',
      });
    },
  );

  it('shows upload progress, then marks the upload complete', () => {
    expect(getUploadChipState({ status: 'uploading', uploadState: uploadState(42) })).toMatchObject(
      {
        busy: true,
        canPreview: false,
        indicator: 'progress',
        progress: 42,
      },
    );
    expect(getUploadChipState({ status: 'success', uploadState: uploadState(100) })).toMatchObject({
      busy: false,
      canPreview: true,
      canRetry: false,
      indicator: 'file',
    });
  });

  it.each(['error', 'cancelled'] as const)(
    'keeps recovery available for %s without opening a preview',
    (status) => {
      expect(getUploadChipState({ status })).toMatchObject({
        busy: false,
        canPreview: false,
        canRetry: true,
        indicator: 'error',
      });
    },
  );

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses indeterminate feedback when progress is unavailable (%s)',
    (progress) => {
      expect(
        getUploadChipState({
          status: 'uploading',
          uploadState: progress === undefined ? undefined : uploadState(progress),
        }).indicator,
      ).toBe('loading');
    },
  );

  it.each([
    [-10, 0],
    [0, 0],
    [150, 100],
  ])('bounds progress %s to %s', (progress, expected) => {
    expect(
      getUploadChipState({ status: 'uploading', uploadState: uploadState(progress) }).progress,
    ).toBe(expected);
  });

  it.each<FileUploadStatus>([
    'pending',
    'uploading',
    'processing',
    'success',
    'error',
    'cancelled',
  ])('allows preview only after success (%s)', (status) => {
    expect(getUploadChipState({ status }).canPreview).toBe(status === 'success');
  });
});

describe('getUploadChipSize', () => {
  const file = new File([new Uint8Array(Math.round(2.4 * 1024 ** 2))], 'screenshot.png');

  it('shows transferred bytes and total size with a shared unit during upload', () => {
    expect(getUploadChipSize({ file, status: 'uploading', uploadState: uploadState(42) })).toBe(
      '1.0/2.4 MB',
    );
    expect(getUploadChipSize({ file, status: 'uploading', uploadState: uploadState(10) })).toBe(
      '0.2/2.4 MB',
    );
  });

  it('shows zero transferred while pending even with stale progress', () => {
    expect(getUploadChipSize({ file, status: 'pending', uploadState: uploadState(100) })).toBe(
      '0.0/2.4 MB',
    );
  });

  it('does not invent transferred bytes when progress is unknown', () => {
    expect(getUploadChipSize({ file, status: 'uploading' })).toBe('—/2.4 MB');
  });

  it('hides size after upload succeeds', () => {
    expect(
      getUploadChipSize({ file, status: 'success', uploadState: uploadState(100) }),
    ).toBeUndefined();
  });

  it('clamps transferred bytes to the total', () => {
    expect(getUploadChipSize({ file, status: 'uploading', uploadState: uploadState(150) })).toBe(
      '2.4/2.4 MB',
    );
  });

  it.each(['processing', 'error', 'cancelled'] as const)(
    'keeps the total size visible for %s',
    (status) => {
      expect(getUploadChipSize({ file, status })).toBe('2.4 MB');
    },
  );

  it('handles empty files without NaN', () => {
    expect(
      getUploadChipSize({
        file: new File([], 'empty.txt'),
        status: 'uploading',
        uploadState: uploadState(0),
      }),
    ).toBe('0.0/0.0 KB');
  });
});
