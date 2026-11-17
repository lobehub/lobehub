import { describe, expect, it } from 'vitest';

import type { UploadFileItem } from '@/types/files/upload';

import { getFailedUploadNames, isFailedUpload } from './failedUploads';

const upload = (name: string, status: UploadFileItem['status']) =>
  ({ file: new File(['x'], name), status }) as Pick<UploadFileItem, 'file' | 'status'>;

describe('failedUploads', () => {
  it('treats only failed and cancelled uploads as unsendable', () => {
    expect(isFailedUpload({ status: 'error' })).toBe(true);
    expect(isFailedUpload({ status: 'cancelled' })).toBe(true);
    expect(isFailedUpload({ status: 'success' })).toBe(false);
    expect(isFailedUpload({ status: 'uploading' })).toBe(false);
  });

  it('lists the names of the uploads that did not finish', () => {
    expect(
      getFailedUploadNames([
        upload('contract.docx', 'error'),
        upload('photo.png', 'success'),
        upload('notes.pdf', 'cancelled'),
      ]),
    ).toEqual(['contract.docx', 'notes.pdf']);
  });
});
