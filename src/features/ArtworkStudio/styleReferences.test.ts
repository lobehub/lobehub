import { describe, expect, it } from 'vitest';

import { styleReferencesForArtworkStyle } from './styleReferences';

describe('styleReferencesForArtworkStyle', () => {
  it('uses the provided app origin for the line-art reference', () => {
    const appOrigin = 'https://self-hosted.example.com:8443';
    const references = styleReferencesForArtworkStyle('lineArt', appOrigin);
    const reference = references?.[0];

    expect(reference).toBe(`${appOrigin}/app-images/agent-artwork-styles/line-art-reference.webp`);
    expect(new URL(reference!).origin).toBe(appOrigin);
  });

  it('omits the line-art reference until an app origin is available', () => {
    expect(styleReferencesForArtworkStyle('lineArt')).toBeUndefined();
  });
});
