import { describe, expect, it } from 'vitest';

import { type DesktopDownloadType } from './index';
import { resolveDesktopDownload, resolveDesktopDownloadFromUrls } from './index';

const mockRelease = {
  assets: [
    {
      browser_download_url: 'https://example.com/LobeHub-2.0.0-arm64.dmg',
      name: 'LobeHub-2.0.0-arm64.dmg',
    },
    {
      browser_download_url: 'https://example.com/LobeHub-2.0.0-x64.dmg',
      name: 'LobeHub-2.0.0-x64.dmg',
    },
    {
      browser_download_url: 'https://example.com/LobeHub-2.0.0-setup.exe',
      name: 'LobeHub-2.0.0-setup.exe',
    },
    {
      browser_download_url: 'https://example.com/LobeHub-2.0.0.AppImage',
      name: 'LobeHub-2.0.0.AppImage',
    },
  ],
  published_at: '2026-01-01T00:00:00.000Z',
  tag_name: 'v2.0.0',
};

describe('desktopRelease', () => {
  it.each([
    ['mac-arm', 'LobeHub-2.0.0-arm64.dmg'],
    ['mac-intel', 'LobeHub-2.0.0-x64.dmg'],
    ['windows', 'LobeHub-2.0.0-setup.exe'],
    ['linux', 'LobeHub-2.0.0.AppImage'],
  ] as Array<[DesktopDownloadType, string]>)(
    'resolveDesktopDownload(%s)',
    (type, expectedAssetName) => {
      const resolved = resolveDesktopDownload(mockRelease as any, type);
      expect(resolved?.assetName).toBe(expectedAssetName);
      expect(resolved?.version).toBe('2.0.0');
      expect(resolved?.tag).toBe('v2.0.0');
      expect(resolved?.type).toBe(type);
      expect(resolved?.url).toContain(expectedAssetName);
    },
  );

  it('resolveDesktopDownloadFromUrls should match basename', () => {
    const resolved = resolveDesktopDownloadFromUrls({
      publishedAt: '2026-01-01T00:00:00.000Z',
      tag: 'v2.0.0',
      type: 'windows',
      urls: [
        'https://releases.example.com/stable/2.0.0/LobeHub-2.0.0-setup.exe?download=1',
        'https://releases.example.com/stable/2.0.0/LobeHub-2.0.0-x64.dmg',
      ],
      version: '2.0.0',
    });

    expect(resolved?.assetName).toBe('LobeHub-2.0.0-setup.exe');
    expect(resolved?.url).toContain('setup.exe');
  });
});
