// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { buildAnalyticsConfig, renderSpaHtml } from '.';

describe('renderSpaHtml', () => {
  it('injects server config, seo meta and strips the analytics placeholder', async () => {
    const template = [
      '<html><head>',
      '<!--SEO_META-->',
      '<script>window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */</script>',
      '</head><body><!--ANALYTICS_SCRIPTS--></body></html>',
    ].join('\n');

    const res = renderSpaHtml(template, {
      seoMeta: '<title>Hi</title>',
      serverConfig: { enableOIDC: true },
    });
    const html = await res.text();

    expect(html).toContain('window.__SERVER_CONFIG__ = {"enableOIDC":true};');
    expect(html).toContain('<title>Hi</title>');
    expect(html).not.toContain('SEO_META');
    expect(html).not.toContain('ANALYTICS_SCRIPTS');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('escapes script-breaking sequences in the server config', async () => {
    const template = 'window.__SERVER_CONFIG__ = undefined; /* SERVER_CONFIG */';
    const res = renderSpaHtml(template, {
      seoMeta: '',
      serverConfig: { html: '</script><script>alert(1)</script>' },
    });

    expect(await res.text()).not.toContain('</script>');
  });
});

describe('buildAnalyticsConfig', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID;
    delete process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL;
  });

  it('includes desktop analytics only when opted in', () => {
    process.env.NEXT_PUBLIC_DESKTOP_PROJECT_ID = 'pid';
    process.env.NEXT_PUBLIC_DESKTOP_UMAMI_BASE_URL = 'https://umami.example.com';

    expect(buildAnalyticsConfig().desktop).toBeUndefined();
    expect(buildAnalyticsConfig({ desktop: true }).desktop).toEqual({
      baseUrl: 'https://umami.example.com',
      projectId: 'pid',
    });
  });
});
