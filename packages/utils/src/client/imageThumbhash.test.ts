import { rgbaToThumbHash } from 'thumbhash';
import { describe, expect, it } from 'vitest';

import { getImageThumbhash, thumbhashToDataUrl } from './imageThumbhash';

const solidHash = () => {
  const rgba = new Uint8Array(4 * 4 * 4).fill(200);
  return btoa(String.fromCodePoint(...rgbaToThumbHash(4, 4, rgba)));
};

describe('getImageThumbhash', () => {
  it('skips files that are not images', async () => {
    await expect(
      getImageThumbhash(new File(['x'], 'notes.txt', { type: 'text/plain' })),
    ).resolves.toBeUndefined();
  });

  it('skips data URIs that are not images', async () => {
    await expect(getImageThumbhash('data:text/plain;base64,eA==')).resolves.toBeUndefined();
  });

  it('resolves to undefined when the image cannot be decoded', async () => {
    await expect(
      getImageThumbhash(new File(['not a png'], 'broken.png', { type: 'image/png' })),
    ).resolves.toBeUndefined();
  });
});

describe('thumbhashToDataUrl', () => {
  it('decodes a base64 ThumbHash into a PNG data URL', () => {
    expect(thumbhashToDataUrl(solidHash())).toMatch(/^data:image\/png;base64,/);
  });

  it('returns undefined for a malformed hash', () => {
    expect(thumbhashToDataUrl('***')).toBeUndefined();
  });
});
