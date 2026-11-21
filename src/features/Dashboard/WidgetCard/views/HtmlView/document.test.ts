import { describe, expect, it } from 'vitest';

import {
  createWidgetHtmlDocument,
  isOpenableWidgetUrl,
  isWidgetHtmlFrameMessage,
  WIDGET_HTML_CSP,
  WIDGET_HTML_WRAPPER_CSP,
  WIDGET_HTML_WRAPPER_DOCUMENT,
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

describe('WIDGET_HTML_WRAPPER_DOCUMENT', () => {
  it('forbids its content frame from navigating anywhere', () => {
    expect(WIDGET_HTML_WRAPPER_CSP).toContain("frame-src 'none'");
    expect(WIDGET_HTML_WRAPPER_CSP).toContain("default-src 'none'");
    // The content frame inherits this policy, so it must not take away what the content may load.
    expect(WIDGET_HTML_WRAPPER_CSP.startsWith(WIDGET_HTML_CSP)).toBe(true);
    expect(WIDGET_HTML_WRAPPER_DOCUMENT.indexOf(`content="${WIDGET_HTML_WRAPPER_CSP}"`)).toBe(
      WIDGET_HTML_WRAPPER_DOCUMENT.indexOf('content="'),
    );
  });

  it('runs the content in a script-only sandbox and drops it on a second load', () => {
    expect(WIDGET_HTML_WRAPPER_DOCUMENT).toContain("setAttribute('sandbox', 'allow-scripts')");
    expect(WIDGET_HTML_WRAPPER_DOCUMENT).toContain("type: 'navigated'");
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
