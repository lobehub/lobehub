// @vitest-environment happy-dom
import { toast } from '@lobehub/ui/base-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileService } from '@/services/file';

import { getFileIdForUrl, registerAttachment } from './attachmentRegistry';
import { needsImageRehost, rehostImage } from './rehostImage';

vi.mock('@/services/file', () => ({ fileService: { rehostImage: vi.fn() } }));
vi.mock('@lobehub/ui/base-ui', () => ({ toast: { error: vi.fn() } }));
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

  it('propagates download failures to the editor', async () => {
    vi.mocked(fileService.rehostImage).mockRejectedValue(new Error('Download failed'));
    await expect(rehostImage('https://cdn.discordapp.com/missing.png')).rejects.toThrow(
      'Download failed',
    );
    expect(getFileIdForUrl('https://cdn.discordapp.com/missing.png')).toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith('uploadDock.body.item.error');
  });
});
