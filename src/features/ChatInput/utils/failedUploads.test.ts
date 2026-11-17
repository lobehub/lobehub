import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadFileItem } from '@/types/files/upload';

import { refuseSendWithFailedUploads } from './failedUploads';

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock('@lobehub/ui', () => ({ toast: { error: toastError } }));

vi.mock('i18next', () => ({
  t: (key: string, options: Record<string, unknown>) => `${key}:${String(options.files)}`,
}));

const upload = (name: string, status: UploadFileItem['status']) => ({
  file: new File(['x'], name),
  status,
});

describe('refuseSendWithFailedUploads', () => {
  beforeEach(() => {
    toastError.mockReset();
  });

  it('refuses the send and names every failed or cancelled upload', () => {
    expect(
      refuseSendWithFailedUploads([
        upload('report.docx', 'error'),
        upload('photo.png', 'success'),
        upload('scan.pdf', 'cancelled'),
      ]),
    ).toBe(true);

    expect(toastError).toHaveBeenCalledWith(
      'upload.validation.failedNotSent:report.docx, scan.pdf',
    );
  });

  it('lets a draft through when every upload finished', () => {
    expect(
      refuseSendWithFailedUploads([upload('a.docx', 'success'), upload('b.png', 'success')]),
    ).toBe(false);
    expect(refuseSendWithFailedUploads([])).toBe(false);

    expect(toastError).not.toHaveBeenCalled();
  });
});
