import { describe, expect, it } from 'vitest';

import {
  ARTBOARD_FILE_LIMITS,
  artboardFileContentType,
  isArtboardImagePath,
  normalizeArtboardFilePath,
} from './artboardFiles';

describe('normalizeArtboardFilePath', () => {
  it('keeps a relative path', () => {
    expect(normalizeArtboardFilePath('pages/home/a.html')).toBe('pages/home/a.html');
  });

  it('drops a leading ./', () => {
    expect(normalizeArtboardFilePath('./shots/a.png')).toBe('shots/a.png');
  });

  it.each(['../a.html', 'pages/../../a.html', '/abs.html', 'a b.html', '', 'pages//a.html'])(
    'rejects %j',
    (path) => {
      expect(normalizeArtboardFilePath(path)).toBeUndefined();
    },
  );

  it('rejects a path longer than the limit', () => {
    expect(
      normalizeArtboardFilePath(`${'a'.repeat(ARTBOARD_FILE_LIMITS.maxPathLength)}.html`),
    ).toBeUndefined();
  });

  it('rejects an extension a board cannot serve', () => {
    expect(normalizeArtboardFilePath('tool.exe')).toBeUndefined();
  });
});

describe('artboardFileContentType', () => {
  it('serves html as utf-8 html', () => {
    expect(artboardFileContentType('pages/a.html')).toBe('text/html; charset=utf-8');
  });

  it('maps images by extension', () => {
    expect(artboardFileContentType('shots/a.JPG')).toBe('image/jpeg');
    expect(isArtboardImagePath('shots/a.webp')).toBe(true);
    expect(isArtboardImagePath('pages/a.html')).toBe(false);
  });
});
