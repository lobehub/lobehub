import { describe, expect, it } from 'vitest';

import { buildAppCsp, injectCsp, pickAppResource, toAppMessage, toCallToolResult } from './utils';

describe('pickAppResource', () => {
  it('picks the matching text entry with its ui meta', () => {
    const resource = pickAppResource(
      {
        contents: [
          { text: 'other', uri: 'ui://other' },
          { _meta: { ui: { prefersBorder: false } }, text: '<p>hi</p>', uri: 'ui://app' },
        ],
      },
      'ui://app',
    );

    expect(resource).toEqual({ html: '<p>hi</p>', meta: { prefersBorder: false } });
  });

  it('decodes base64 blobs as UTF-8', () => {
    const blob = btoa(String.fromCharCode(...new TextEncoder().encode('<p>你好</p>')));

    expect(pickAppResource({ contents: [{ blob, uri: 'ui://app' }] }, 'ui://app')?.html).toBe(
      '<p>你好</p>',
    );
  });

  it('returns undefined for empty results', () => {
    expect(pickAppResource(undefined, 'ui://app')).toBeUndefined();
    expect(pickAppResource({ contents: [] }, 'ui://app')).toBeUndefined();
  });
});

describe('buildAppCsp', () => {
  it('blocks the network by default', () => {
    const csp = buildAppCsp(undefined);

    expect(csp).toContain(`default-src 'none'`);
    expect(csp).toContain(`connect-src 'none'`);
    expect(csp).toContain(`frame-src 'none'`);
  });

  it('allows declared domains and drops ones that could break out of the policy', () => {
    const csp = buildAppCsp({
      connectDomains: ['https://api.example.com', "https://x.com; script-src 'unsafe-eval'"],
      resourceDomains: ['https://*.cdn.example.com'],
    });

    expect(csp).toContain('connect-src https://api.example.com');
    expect(csp).toContain(`script-src 'unsafe-inline' https://*.cdn.example.com`);
    expect(csp).not.toContain('unsafe-eval');
  });
});

describe('injectCsp', () => {
  const policy = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'">`;

  it('puts the policy ahead of the whole document, which stays as written', () => {
    const app = '<!doctype html><html lang="en"><head><script>1</script></head></html>';

    expect(injectCsp(app, "default-src 'none'")).toBe(policy + app);
  });

  it('is not fooled by a <head> inside a comment', () => {
    const app = '<!-- <head> --><script>fetch("https://x")</script><head></head>';

    expect(injectCsp(app, "default-src 'none'")).toBe(policy + app);
  });

  it('covers a script placed before the real <head>', () => {
    const app = '<script>fetch("https://x")</script><html><head></head></html>';

    expect(injectCsp(app, "default-src 'none'")).toBe(policy + app);
  });

  it('escapes the policy into its attribute', () => {
    expect(injectCsp('<div></div>', `a"&`)).toBe(
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="a&quot;&amp;"><div></div>',
    );
  });
});

describe('toAppMessage', () => {
  it('tags the posted message with the view it came from', () => {
    expect(toAppMessage('What should I wear in Paris?', 'weather-demo')).toEqual({
      message: 'What should I wear in Paris?',
      metadata: { mcpAppSource: { identifier: 'weather-demo' } },
    });
  });
});

describe('toCallToolResult', () => {
  it('returns the raw MCP result without the LobeHub mcpApp marker', () => {
    const result = toCallToolResult({
      content: 'sunny',
      state: {
        content: [{ text: 'sunny', type: 'text' }],
        mcpApp: { resourceUri: 'ui://app' },
        structuredContent: { temp: 20 },
      } as any,
      success: true,
    });

    expect(result).toEqual({
      content: [{ text: 'sunny', type: 'text' }],
      structuredContent: { temp: 20 },
    });
  });

  it('wraps plain text results and missing results', () => {
    expect(toCallToolResult({ content: 'ok', state: undefined as any, success: true })).toEqual({
      content: [{ text: 'ok', type: 'text' }],
      isError: false,
    });
    expect(toCallToolResult(undefined).isError).toBe(true);
  });
});
