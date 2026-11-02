import { describe, expect, it } from 'vitest';

import {
  createWidgetHtmlDocument,
  isOpenableWidgetUrl,
  isWidgetHtmlFrameMessage,
  WIDGET_HTML_CSP,
} from './document';

describe('createWidgetHtmlDocument', () => {
  it('puts the CSP before the author markup', () => {
    const doc = createWidgetHtmlDocument(
      '<!doctype html><html><head></head><body>hi</body></html>',
    );
    const csp = doc.indexOf(`content="${WIDGET_HTML_CSP}"`);
    expect(csp).toBeGreaterThanOrEqual(0);
    expect(csp).toBeLessThan(doc.indexOf('<!doctype html>'));
    expect(doc.indexOf('window.widgetData')).toBeLessThan(doc.indexOf('<!doctype html>'));
  });

  it('blocks network access', () => {
    expect(WIDGET_HTML_CSP).toContain("default-src 'none'");
    expect(WIDGET_HTML_CSP).not.toMatch(/connect-src|https?:/);
  });
});

describe('isOpenableWidgetUrl', () => {
  it.each([
    ['https://github.com/lobehub/lobehub/pull/1', true],
    ['http://example.com', true],
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['/relative', false],
    [42, false],
  ])('%s → %s', (url, expected) => {
    expect(isOpenableWidgetUrl(url)).toBe(expected);
  });
});

describe('isWidgetHtmlFrameMessage', () => {
  it('only accepts messages from the widget frame', () => {
    expect(isWidgetHtmlFrameMessage({ source: 'lobe-widget-frame', type: 'ready' })).toBe(true);
    expect(isWidgetHtmlFrameMessage({ source: 'other', type: 'ready' })).toBe(false);
    expect(isWidgetHtmlFrameMessage(null)).toBe(false);
  });
});
