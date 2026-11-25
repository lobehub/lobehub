import { describe, expect, it } from 'vitest';

import { parseLinkPreview } from './parse';

const PAGE = 'https://ryugi.example.com/a/report?page=audit';

describe('parseLinkPreview', () => {
  it('reads the Open Graph card and resolves a relative image against the page', () => {
    const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:site_name" content="Ryugi">
      <meta property="og:title" content="Audit report &amp; findings" />
      <meta content="Three  issues
        found" property='og:description'>
      <meta property="og:image" content="/og/report.png">
    </head><body></body></html>`;

    expect(parseLinkPreview(html, PAGE)).toEqual({
      description: 'Three issues found',
      image: 'https://ryugi.example.com/og/report.png',
      siteName: 'Ryugi',
      title: 'Audit report & findings',
      url: PAGE,
    });
  });

  it('falls back to Twitter card tags, then the page title and meta description', () => {
    const twitter = `<head><meta name="twitter:title" content="Tweet title">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:image" content="https://cdn.example.com/wide.jpg"></head>`;
    expect(parseLinkPreview(twitter, PAGE)).toMatchObject({
      image: 'https://cdn.example.com/wide.jpg',
      largeImage: true,
      title: 'Tweet title',
    });

    const plain = `<head><TITLE>Plain page</TITLE><meta name="Description" content="About it"></head>`;
    expect(parseLinkPreview(plain, PAGE)).toEqual({
      description: 'About it',
      title: 'Plain page',
      url: PAGE,
    });
  });

  it('ignores meta tags quoted in the body once the head has closed', () => {
    const html = `<head><title>Real</title></head>
      <body><meta property="og:title" content="Injected"></body>`;
    expect(parseLinkPreview(html, PAGE)?.title).toBe('Real');
  });

  it('shows no card for a page that names neither a title nor a description', () => {
    expect(parseLinkPreview('<head><meta property="og:image" content="/a.png"></head>', PAGE)).toBe(
      null,
    );
    expect(parseLinkPreview('{"json":true}', PAGE)).toBe(null);
  });

  it('drops images that are not web addresses and clips long text', () => {
    const html = `<head><meta property="og:title" content="${'t'.repeat(500)}">
      <meta property="og:image" content="javascript:alert(1)"></head>`;
    const preview = parseLinkPreview(html, PAGE);
    expect(preview?.image).toBeUndefined();
    expect(preview?.title).toHaveLength(200);
    expect(preview?.title?.endsWith('…')).toBe(true);
  });
});
