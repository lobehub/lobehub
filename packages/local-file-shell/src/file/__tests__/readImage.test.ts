import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readLocalImageFile } from '../readImage';

describe('readLocalImageFile upload failures', () => {
  const tmpDir = path.join(os.tmpdir(), 'local-file-shell-read-image-test-' + process.pid);
  const filePath = path.join(tmpDir, 'homework-12.jpg');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    await writeFile(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { force: true, recursive: true });
  });

  // `lh connect` uploads in process, so the server's TRPC error reaches the
  // reader as-is. A full storage used to come back as the bare code and no
  // structured reason, so neither the model nor the card could tell it apart.
  it('reports a full file storage as a structured storage_quota failure', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('storage_block:upgrade_required'));

    const result = await readLocalImageFile({ path: filePath }, 'image/jpeg', { upload });

    expect(result.isImage).toBe(true);
    expect(result.imageUrl).toBeUndefined();
    expect(result.uploadError).toEqual({
      kind: 'storage_quota',
      reason: 'storage_block:upgrade_required',
    });
    expect(result.content).toContain('[Image: homework-12.jpg] (upload unavailable — ');
    expect(result.content).toContain('storage_block:upgrade_required');
    // The rest of a batch fails the same way: the model must stop, not retry.
    expect(result.content).toMatch(/retrying will not help/i);
    expect(result.content).toMatch(/do not read more images/i);
    expect(result.content).toMatch(/resource library|upgrade their plan/i);
  });

  it('keeps any other upload error as an unknown failure with its message', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('Upload failed: 403 Forbidden'));

    const result = await readLocalImageFile({ path: filePath }, 'image/jpeg', { upload });

    expect(result.uploadError).toEqual({ kind: 'unknown', reason: 'Upload failed: 403 Forbidden' });
    expect(result.content).toContain(
      'Upload failed: 403 Forbidden; the model cannot view this image',
    );
  });

  it("uses the host's classifier when one is passed", async () => {
    const upload = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const classifyUploadError = vi
      .fn()
      .mockReturnValue({ kind: 'network', reason: 'fetch failed' });

    const result = await readLocalImageFile({ path: filePath }, 'image/jpeg', {
      classifyUploadError,
      upload,
    });

    expect(classifyUploadError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.uploadError).toEqual({ kind: 'network', reason: 'fetch failed' });
    expect(result.content).toMatch(/network error while uploading \(fetch failed\)/);
  });

  it('leaves uploadError unset when the upload succeeds', async () => {
    const upload = vi
      .fn()
      .mockResolvedValue({ id: 'file_1', url: 'https://files.example.com/a.jpg' });

    const result = await readLocalImageFile({ path: filePath }, 'image/jpeg', { upload });

    expect(result.uploadError).toBeUndefined();
    expect(result.imageUrl).toBe('https://files.example.com/a.jpg');
  });
});
