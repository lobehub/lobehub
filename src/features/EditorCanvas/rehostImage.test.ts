// @vitest-environment happy-dom
import { toast } from '@lobehub/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';

import { getFileIdForUrl, registerAttachment } from './attachmentRegistry';
import { MAX_CONCURRENT_REHOSTS, needsImageRehost, rehostImage } from './rehostImage';

vi.mock('@/services/file', () => ({ fileService: { rehostImage: vi.fn() } }));
vi.mock('@lobehub/ui', () => ({ toast: { error: vi.fn() } }));
vi.mock('i18next', () => ({ t: (key: string) => key }));

const setWindowUrl = (url: string) => {
  (window as typeof window & { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
};

describe('editor image rehosting', () => {
  const defaultUrl = window.location.href;

  beforeEach(() => {
    vi.clearAllMocks();
    setWindowUrl(defaultUrl);
  });

  it('transfers Discord and external image URLs', () => {
    expect(needsImageRehost('https://cdn.discordapp.com/attachments/image.png?ex=123')).toBe(true);
    expect(needsImageRehost('https://external.example/f/image.png')).toBe(true);
  });

  it('normalizes protocol-relative images to HTTPS on the desktop origin', async () => {
    setWindowUrl('app://renderer/');
    vi.mocked(fileService.rehostImage).mockResolvedValue({
      fileId: 'rehosted-file',
      url: 'https://storage.example/rehosted.png',
    });

    expect(needsImageRehost('//media.discordapp.net/image.png')).toBe(true);
    await rehostImage('//media.discordapp.net/image.png');

    expect(fileService.rehostImage).toHaveBeenCalledWith('https://media.discordapp.net/image.png');
  });

  it('does not transfer internal attachments or local image upload sources', () => {
    for (const url of [
      '/f/image-id',
      `${window.location.origin}/f/image-id`,
      'data:image/png;base64,abc',
      'blob:https://example.com/id',
      'desktop://image.png',
    ]) {
      expect(needsImageRehost(url)).toBe(false);
    }
    registerAttachment('https://storage.example/uploaded.png', 'stored-file');
    expect(needsImageRehost('https://storage.example/uploaded.png')).toBe(false);
  });

  it('registers the returned file for document persistence and prevents repeat rehosting', async () => {
    vi.mocked(fileService.rehostImage).mockResolvedValue({
      fileId: 'rehosted-file',
      url: 'https://storage.example/rehosted.png',
    });
    await expect(rehostImage('https://cdn.discordapp.com/example.png')).resolves.toEqual({
      url: 'https://storage.example/rehosted.png',
    });
    expect(fileService.rehostImage).toHaveBeenCalledWith('https://cdn.discordapp.com/example.png');
    expect(getFileIdForUrl('https://storage.example/rehosted.png')).toBe('rehosted-file');
    expect(needsImageRehost('https://storage.example/rehosted.png')).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps at most MAX_CONCURRENT_REHOSTS rehosts in flight when many images are pasted', async () => {
    let inFlight = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    vi.mocked(fileService.rehostImage).mockImplementation(async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => pending.push(resolve));
      inFlight -= 1;
      return { fileId: `file-${url}`, url: `${url}?rehosted` };
    });

    const urls = Array.from({ length: 20 }, (_, i) => `https://cdn.example/paste-${i}.png`);
    const all = Promise.all(urls.map((url) => rehostImage(url)));

    while (pending.length > 0 || inFlight > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      pending.shift()?.();
    }

    await expect(all).resolves.toHaveLength(20);
    expect(fileService.rehostImage).toHaveBeenCalledTimes(20);
    expect(peak).toBe(MAX_CONCURRENT_REHOSTS);
  });

  it('releases the slot when a rehost fails', async () => {
    vi.mocked(fileService.rehostImage).mockRejectedValue(new Error('Download failed'));
    const failures = Array.from({ length: MAX_CONCURRENT_REHOSTS + 2 }, (_, i) =>
      rehostImage(`https://cdn.example/broken-${i}.png`).catch(() => 'failed'),
    );
    await expect(Promise.all(failures)).resolves.toEqual(
      Array.from({ length: MAX_CONCURRENT_REHOSTS + 2 }, () => 'failed'),
    );
  });

  it('propagates download failures to the editor', async () => {
    vi.mocked(fileService.rehostImage).mockRejectedValue(new Error('Download failed'));
    await expect(rehostImage('https://cdn.discordapp.com/missing.png')).rejects.toThrow(
      'Download failed',
    );
    expect(getFileIdForUrl('https://cdn.discordapp.com/missing.png')).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('uploadDock.body.item.error');
  });
});
