import { describe, expect, it } from 'vitest';

import { applyHtmlPreviewBaseUrl } from './applyBaseUrl';

describe('applyHtmlPreviewBaseUrl', () => {
  const baseUrl = 'localfile://preview-session/pages/';

  it('injects the filesystem base at the beginning of an existing head', () => {
    const result = applyHtmlPreviewBaseUrl(
      '<!doctype html><html><head><link href="styles.css"></head><body></body></html>',
      baseUrl,
    );

    expect(result).toContain(`<head><base href="${baseUrl}"><link href="styles.css">`);
  });

  it('wraps HTML fragments so their relative resources use the filesystem base', () => {
    const result = applyHtmlPreviewBaseUrl('<img src="images/logo.png">', baseUrl);

    expect(result).toBe(
      `<!doctype html><html><head><base href="${baseUrl}"></head><body><img src="images/logo.png"></body></html>`,
    );
  });

  it('resolves an author-provided relative base against the filesystem base', () => {
    const result = applyHtmlPreviewBaseUrl(
      '<html><head><base href="../shared/"></head></html>',
      baseUrl,
    );

    expect(result).toContain('<base href="localfile://preview-session/shared/">');
  });

  it('preserves an author-provided absolute web base', () => {
    const content = '<html><head><base href="https://cdn.example.com/app/"></head></html>';

    expect(applyHtmlPreviewBaseUrl(content, baseUrl)).toBe(content);
  });
});
