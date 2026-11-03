import { describe, expect, it } from 'vitest';

import { resolveLocalSystemRenderDisplayControl } from './displayControls';

const imageRead = {
  images: [{ mediaType: 'image/png', url: 'https://cdn.test/g1.png' }],
  path: 'shots/g1.png',
};

describe('resolveLocalSystemRenderDisplayControl', () => {
  it('opens the card for a read that uploaded an image', () => {
    expect(resolveLocalSystemRenderDisplayControl('readFile', imageRead)).toBe('expand');
  });

  it('keeps a text read collapsed so it does not dump a file into the transcript', () => {
    expect(
      resolveLocalSystemRenderDisplayControl('readFile', { content: 'const a = 1;', path: 'a.ts' }),
    ).toBeUndefined();
  });

  it('keeps the card collapsed while the read is still in flight', () => {
    expect(resolveLocalSystemRenderDisplayControl('readFile')).toBeUndefined();
    expect(resolveLocalSystemRenderDisplayControl('readFile', undefined)).toBeUndefined();
  });

  it('does not open an empty card when the image never got a url', () => {
    expect(
      resolveLocalSystemRenderDisplayControl('readFile', {
        images: [{ mediaType: 'image/png' }],
        path: 'shots/g1.png',
      }),
    ).toBeUndefined();
  });

  it('opens the card for the legacy readLocalFile alias too', () => {
    // Older gateways emit `readLocalFile`, and persisted results still carry that
    // name; `LocalSystemRenders` keeps the alias registered for those historical
    // messages, so the display control has to answer for both names.
    expect(resolveLocalSystemRenderDisplayControl('readLocalFile', imageRead)).toBe('expand');
  });

  it('keeps a legacy-named text read collapsed', () => {
    expect(
      resolveLocalSystemRenderDisplayControl('readLocalFile', {
        content: 'const a = 1;',
        path: 'a.ts',
      }),
    ).toBeUndefined();
  });

  it('only refines readFile, not the other local-system APIs', () => {
    expect(resolveLocalSystemRenderDisplayControl('runCommand', imageRead)).toBeUndefined();
    expect(resolveLocalSystemRenderDisplayControl('grepContent', imageRead)).toBeUndefined();
  });
});
