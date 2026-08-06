import { describe, expect, it } from 'vitest';

import { normalizeSpaHtmlPublicPaths } from './generateSpaTemplatesCore';

describe('normalizeSpaHtmlPublicPaths', () => {
  it('maps SPA-base icon URLs back to root public/icons', () => {
    const html =
      '<img alt="Panachat" src="/_spa/icons/icon-192x192.png" />' +
      '<img alt="Panachat" src="/_spa-auth/icons/icon-192x192.png" />';

    expect(normalizeSpaHtmlPublicPaths(html)).toBe(
      '<img alt="Panachat" src="/icons/icon-192x192.png" />' +
        '<img alt="Panachat" src="/icons/icon-192x192.png" />',
    );
  });

  it('leaves other SPA asset URLs unchanged', () => {
    const html = '<script src="/_spa/assets/index.js"></script>';

    expect(normalizeSpaHtmlPublicPaths(html)).toBe(html);
  });
});
