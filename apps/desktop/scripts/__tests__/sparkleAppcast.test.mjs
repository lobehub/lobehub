import { describe, expect, it } from 'vitest';

import { ownZipName, previousArchives, s3KeyFromUrl } from '../sparkleAppcast.mjs';

const files = [
  'LobeHub-2.2.19-canary.1-arm64-mac.zip',
  'LobeHub-2.2.19-canary.1-arm64-mac.zip.blockmap',
  'LobeHub-2.2.19-canary.1-mac.zip',
  'LobeHub-2.2.19-canary.1-arm64.dmg',
  'LobeHub-2.2.19-canary.1-x64.dmg',
];

describe('ownZipName', () => {
  it('picks the arm64 zip by its arch suffix', () => {
    expect(ownZipName(files, '2.2.19-canary.1', 'arm64')).toBe(
      'LobeHub-2.2.19-canary.1-arm64-mac.zip',
    );
  });

  it('picks the x64 zip, which electron-builder names without an arch', () => {
    expect(ownZipName(files, '2.2.19-canary.1', 'x64')).toBe('LobeHub-2.2.19-canary.1-mac.zip');
  });

  it('fails when the version has no matching zip', () => {
    expect(() => ownZipName(files, '2.2.18-canary.9', 'x64')).toThrow(/found 0/);
  });
});

describe('previousArchives', () => {
  const feed = `<?xml version="1.0"?><rss><channel>
<item><title>2.2.18-canary.2</title><sparkle:version>2.2.18-canary.2</sparkle:version>
<enclosure url="https://cdn.example.com/canary/2.2.18-canary.2/LobeHub-2.2.18-canary.2-mac.zip" length="1" type="application/octet-stream" sparkle:edSignature="sig"/>
<sparkle:deltas><enclosure url="https://cdn.example.com/canary/2.2.18-canary.2/LobeHub-1.delta" sparkle:deltaFrom="2.2.18-canary.1"/></sparkle:deltas></item>
<item><title>2.2.18-canary.1</title>
<enclosure url="https://cdn.example.com/canary/2.2.18-canary.1/LobeHub-2.2.18-canary.1-mac.zip" sparkle:version="2.2.18-canary.1"/></item>
</channel></rss>`;

  it('lists the newest full archives first, ignoring delta enclosures', () => {
    expect(previousArchives(feed, 2)).toEqual([
      {
        url: 'https://cdn.example.com/canary/2.2.18-canary.2/LobeHub-2.2.18-canary.2-mac.zip',
        version: '2.2.18-canary.2',
      },
      {
        url: 'https://cdn.example.com/canary/2.2.18-canary.1/LobeHub-2.2.18-canary.1-mac.zip',
        version: '2.2.18-canary.1',
      },
    ]);
  });

  it('bounds the result to the requested delta bases', () => {
    expect(previousArchives(feed, 1)).toHaveLength(1);
  });
});

describe('s3KeyFromUrl', () => {
  it('maps an enclosure back to its bucket key', () => {
    expect(
      s3KeyFromUrl(
        'https://cdn.example.com/canary/2.2.18-canary.2/a.zip',
        'https://cdn.example.com/',
      ),
    ).toBe('canary/2.2.18-canary.2/a.zip');
  });

  it('rejects enclosures hosted elsewhere', () => {
    expect(() =>
      s3KeyFromUrl('https://evil.example.com/a.zip', 'https://cdn.example.com'),
    ).toThrow();
  });
});
