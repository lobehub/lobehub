import { describe, expect, it } from 'vitest';

import {
  buildAppFrameDocument,
  buildExternalFrameDocument,
  isAppFrameNavigatedNotice,
  isRenderableExternalUrl,
  MCP_APP_FRAME_SOURCE,
  VIEW_FRAME_SANDBOX,
} from './frameDocument';
import { APP_IFRAME_ALLOW, buildAppCsp, injectCsp } from './utils';

/** The view document the wrapper script assigns to its frame's `srcdoc`. */
const readViewDocument = (wrapper: string) => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(wrapper)?.[1];
  return literal === undefined ? undefined : (JSON.parse(literal) as string);
};

describe('buildAppFrameDocument', () => {
  const csp = buildAppCsp({ frameDomains: ['https://maps.example.com'] });

  it('puts the view policy ahead of the wrapper markup, so it governs the view frame navigation', () => {
    const wrapper = buildAppFrameDocument('<p>weather</p>', csp);

    // The view frame inherits this policy: the same one keeps what the resource declared
    expect(wrapper.startsWith(injectCsp('', csp))).toBe(true);
    expect(csp).toContain('frame-src https://maps.example.com');
  });

  it('keeps an undeclared view frame from navigating anywhere', () => {
    const wrapper = buildAppFrameDocument('<p>weather</p>', buildAppCsp(undefined));

    expect(wrapper).toContain(`frame-src 'none'`);
  });

  it('runs the app HTML behind the same policy in a frame without more sandbox powers', () => {
    const wrapper = buildAppFrameDocument('<p>weather</p>', csp);

    expect(readViewDocument(wrapper)).toBe(injectCsp('<p>weather</p>', csp));
    expect(wrapper).toContain(
      `frame.setAttribute('sandbox', ${JSON.stringify(VIEW_FRAME_SANDBOX)})`,
    );
    expect(wrapper).toContain(`frame.setAttribute('allow', ${JSON.stringify(APP_IFRAME_ALLOW)})`);
    expect(VIEW_FRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(VIEW_FRAME_SANDBOX).not.toContain('allow-top-navigation');
    expect(VIEW_FRAME_SANDBOX).not.toContain('allow-popups');
  });

  it('keeps app markup that closes a script from escaping into the wrapper', () => {
    const app = '</script><script>parent.location="https://evil.example"</script><!--';
    const wrapper = buildAppFrameDocument(app, csp);

    expect(wrapper.match(/<\/script>/g)).toHaveLength(1);
    expect(wrapper).not.toContain('<!--');
    expect(readViewDocument(wrapper)).toBe(injectCsp(app, csp));
  });

  it('drops the view and tells the host once its frame loads a second document', () => {
    const wrapper = buildAppFrameDocument('<p>weather</p>', csp);

    expect(wrapper).toContain('if (loads < 2 || dropped) return;');
    expect(wrapper).toContain('frame.remove();');
    expect(wrapper).toContain(`source: ${JSON.stringify(MCP_APP_FRAME_SOURCE)}, type: 'navigated'`);
  });
});

describe('isAppFrameNavigatedNotice', () => {
  it('only accepts the wrapper notice', () => {
    expect(isAppFrameNavigatedNotice({ source: MCP_APP_FRAME_SOURCE, type: 'navigated' })).toBe(
      true,
    );
    expect(isAppFrameNavigatedNotice({ source: MCP_APP_FRAME_SOURCE, type: 'ready' })).toBe(false);
    expect(isAppFrameNavigatedNotice({ jsonrpc: '2.0', method: 'ui/message' })).toBe(false);
    expect(isAppFrameNavigatedNotice(null)).toBe(false);
  });
});

describe('buildExternalFrameDocument (MCP-UI text/uri-list)', () => {
  const wrapper = buildExternalFrameDocument('https://widgets.example.com/card?id=1');

  it('holds the page frame to its own origin and loads it by src', () => {
    expect(wrapper.indexOf('Content-Security-Policy')).toBeLessThan(wrapper.indexOf('<script>'));
    expect(wrapper).toContain(`frame-src https://widgets.example.com;`);
    expect(wrapper).toContain(`default-src 'none'`);
    expect(wrapper).toContain('frame.src = "https://widgets.example.com/card?id=1";');
    expect(wrapper).not.toContain('frame.srcdoc');
  });

  it('runs the page on an opaque origin, without a referrer', () => {
    expect(wrapper).toContain(
      `frame.setAttribute('sandbox', ${JSON.stringify(VIEW_FRAME_SANDBOX)});`,
    );
    expect(VIEW_FRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(wrapper).toContain(`frame.setAttribute('referrerpolicy', 'no-referrer');`);
  });

  it('lets the page move within its origin instead of dropping it on a second load', () => {
    expect(wrapper).toContain('if (false) frame.addEventListener');
    expect(buildAppFrameDocument('<p/>', buildAppCsp(undefined))).toContain(
      'if (true) frame.addEventListener',
    );
  });
});

describe('isRenderableExternalUrl', () => {
  const host = 'https://app.lobehub.com';

  it('accepts https anywhere and http on this machine only', () => {
    expect(isRenderableExternalUrl('https://widgets.example.com/a', host)).toBe(true);
    expect(isRenderableExternalUrl('http://localhost:39742/page', host)).toBe(true);
    expect(isRenderableExternalUrl('http://127.0.0.1/page', host)).toBe(true);
    expect(isRenderableExternalUrl('http://widgets.example.com/a', host)).toBe(false);
  });

  it("refuses LobeHub's own origin, credentials and other schemes", () => {
    expect(isRenderableExternalUrl('https://app.lobehub.com/settings', host)).toBe(false);
    expect(isRenderableExternalUrl('https://user:pw@widgets.example.com', host)).toBe(false);
    expect(isRenderableExternalUrl('javascript:alert(1)', host)).toBe(false);
    expect(isRenderableExternalUrl('not a url', host)).toBe(false);
  });
});
