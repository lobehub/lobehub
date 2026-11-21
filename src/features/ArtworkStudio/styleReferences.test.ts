import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { imageUrl } from '@lobechat/const';
import { AGENT_ARTWORK_STYLES } from '@lobechat/prompts';
import { describe, expect, it } from 'vitest';

import { styleReferencesForArtworkStyle } from './styleReferences';

describe('styleReferencesForArtworkStyle', () => {
  it('uses the provided app origin for the line-art reference', () => {
    const appOrigin = 'https://self-hosted.example.com:8443';
    const references = styleReferencesForArtworkStyle('lineArt', appOrigin);
    const reference = references?.[0];

    expect(reference).toBe(
      `${appOrigin}/static/app-images/agent-artwork-styles/line-art-reference.webp`,
    );
    expect(new URL(reference!).origin).toBe(appOrigin);

    const bytes = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../public',
        new URL(reference!).pathname.slice(1),
      ),
    );
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  });

  it('omits the line-art reference until an app origin is available', () => {
    expect(styleReferencesForArtworkStyle('lineArt')).toBeUndefined();
  });

  it.each(AGENT_ARTWORK_STYLES.filter((style) => style !== 'lobe'))(
    'ships the %s preview at the URL requested by the artwork gallery',
    (style) => {
      const pathname = imageUrl(`agent-artwork-styles/style-${style}.webp`);
      expect(pathname.startsWith('/static/')).toBe(true);
      const bytes = readFileSync(
        path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          '../../../public',
          pathname.slice(1),
        ),
      );
      expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
      expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
    },
  );
});
