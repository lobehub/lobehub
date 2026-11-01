import { beforeEach, describe, expect, it, vi } from 'vitest';

import { electronSystemService } from '@/services/electron/system';

import { openTrustedExternalUrl } from '../openTrustedExternalUrl';

// `isDesktop` is read inside the helper on every call, so a getter lets each
// test flip the platform without re-importing the module.
const { isDesktopRef } = vi.hoisted(() => ({ isDesktopRef: { value: false } }));

vi.mock('@/const/version', () => ({
  get isDesktop() {
    return isDesktopRef.value;
  },
}));
vi.mock('@/services/electron/system', () => ({
  electronSystemService: { openExternalLink: vi.fn().mockResolvedValue(undefined) },
}));

const windowOpen = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  isDesktopRef.value = false;
  vi.stubGlobal('open', windowOpen);
});

describe('openTrustedExternalUrl', () => {
  describe('web', () => {
    it('opens a new detached tab via window.open', () => {
      openTrustedExternalUrl('https://github.com/lobehub/lobehub/pull/19676');

      expect(windowOpen).toHaveBeenCalledWith(
        'https://github.com/lobehub/lobehub/pull/19676',
        '_blank',
        'noopener,noreferrer',
      );
      expect(electronSystemService.openExternalLink).not.toHaveBeenCalled();
    });
  });

  describe('desktop', () => {
    beforeEach(() => {
      isDesktopRef.value = true;
    });

    it('hands the URL to the electron main process', () => {
      openTrustedExternalUrl('https://github.com/lobehub/lobehub/pull/19676');

      expect(electronSystemService.openExternalLink).toHaveBeenCalledWith(
        'https://github.com/lobehub/lobehub/pull/19676',
      );
      expect(windowOpen).not.toHaveBeenCalled();
    });
  });

  describe('protocol gate', () => {
    it.each(['file:///etc/passwd', 'vscode://x', 'javascript:alert(1)', 'mailto:a@b.com'])(
      'refuses %s — only http(s) may reach the OS handler',
      (uri) => {
        openTrustedExternalUrl(uri);

        expect(windowOpen).not.toHaveBeenCalled();
        expect(electronSystemService.openExternalLink).not.toHaveBeenCalled();
      },
    );

    it('silently ignores text that is not a URL', () => {
      openTrustedExternalUrl('not a link');

      expect(windowOpen).not.toHaveBeenCalled();
      expect(electronSystemService.openExternalLink).not.toHaveBeenCalled();
    });
  });
});
