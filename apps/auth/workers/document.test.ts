import { describe, expect, it } from 'vitest';

import { SERVER_CONFIG_PLACEHOLDER } from '../app/lib/serverConfig';
import { injectServerConfig, withDocumentLocale } from './document';

const documentWith = (head: string) => `<html lang="en-US"><head>${head}</head></html>`;

describe('injectServerConfig', () => {
  it('replaces the placeholder the renderer emits', () => {
    const html = injectServerConfig(documentWith(SERVER_CONFIG_PLACEHOLDER), { enableOIDC: true });

    expect(html).toContain('window.__SERVER_CONFIG__ = {"enableOIDC":true};');
    expect(html).not.toContain(SERVER_CONFIG_PLACEHOLDER);
  });

  it('escapes sequences that would break out of the script', () => {
    const html = injectServerConfig(documentWith(SERVER_CONFIG_PLACEHOLDER), {
      html: '</script><script>alert(1)</script>',
    });

    expect(html).not.toContain('</script><script>');
  });

  it('leaves the document untouched when no config was resolved', () => {
    const original = documentWith(SERVER_CONFIG_PLACEHOLDER);

    expect(injectServerConfig(original, undefined)).toBe(original);
  });
});

describe('withDocumentLocale', () => {
  it('rewrites the lang the SPA fallback was prerendered with', () => {
    expect(
      withDocumentLocale('<html suppressHydrationWarning dir="ltr" lang="en-US">', 'zh-CN'),
    ).toBe('<html suppressHydrationWarning dir="ltr" lang="zh-CN">');
  });
});
