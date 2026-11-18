import { describe, expect, it } from 'vitest';

import {
  describeMcpUiResourceBlock,
  firstUriListUrl,
  getMcpUiResources,
  hasMcpUiResource,
  MCP_UI_RESOURCE_MAX_LENGTH,
  parseMcpUiResource,
} from './mcpUiResource';

const html = (resource: Record<string, unknown>) => ({
  resource: { mimeType: 'text/html', uri: 'ui://demo/card', ...resource },
  type: 'resource',
});

describe('parseMcpUiResource', () => {
  it('reads embedded HTML from text or a base64 blob', () => {
    expect(parseMcpUiResource(html({ text: '<b>hi</b>' }))).toEqual({
      html: '<b>hi</b>',
      kind: 'html',
      uri: 'ui://demo/card',
    });
    expect(parseMcpUiResource(html({ blob: btoa('<i>yo</i>') }))).toMatchObject({
      html: '<i>yo</i>',
      kind: 'html',
    });
  });

  it('accepts the MCP Apps profile and mime type parameters case-insensitively', () => {
    expect(
      parseMcpUiResource(html({ mimeType: 'Text/HTML; profile=mcp-app', text: '<p/>' })),
    ).toMatchObject({ kind: 'html' });
  });

  it('reads the first http(s) URL of a text/uri-list', () => {
    expect(
      parseMcpUiResource(
        html({
          mimeType: 'text/uri-list',
          text: '# comment\nhttps://example.com/widget\nhttps://example.com/other',
        }),
      ),
    ).toEqual({ kind: 'url', uri: 'ui://demo/card', url: 'https://example.com/widget' });
  });

  it('renders nothing for non-ui URIs, other mime types, bad URLs and oversized bodies', () => {
    expect(
      parseMcpUiResource({
        resource: { mimeType: 'text/html', text: 'x', uri: 'file:///a' },
        type: 'resource',
      }),
    ).toBeUndefined();
    expect(
      parseMcpUiResource(html({ mimeType: 'application/vnd.mcp-ui.remote-dom', text: 'x' })),
    ).toBeUndefined();
    expect(
      parseMcpUiResource(html({ mimeType: 'text/uri-list', text: 'javascript:alert(1)' })),
    ).toBeUndefined();
    expect(
      parseMcpUiResource(html({ text: 'a'.repeat(MCP_UI_RESOURCE_MAX_LENGTH + 1) })),
    ).toBeUndefined();
    expect(parseMcpUiResource(html({ blob: '%%%not-base64' }))).toBeUndefined();
    expect(parseMcpUiResource({ text: 'x', type: 'text' })).toBeUndefined();
  });
});

describe('firstUriListUrl', () => {
  it('skips comments and blank lines', () => {
    expect(firstUriListUrl('\n#x\r\n  http://localhost:3000/a  \n')).toBe(
      'http://localhost:3000/a',
    );
    expect(firstUriListUrl('# only a comment')).toBeUndefined();
  });
});

describe('getMcpUiResources / hasMcpUiResource', () => {
  const content = [
    { text: 'Here is your card', type: 'text' },
    html({ text: '<b>1</b>' }),
    html({ mimeType: 'text/uri-list', text: 'https://example.com' }),
  ];

  it('lists renderable views in order', () => {
    expect(getMcpUiResources(content).map((r) => r.kind)).toEqual(['html', 'url']);
    expect(hasMcpUiResource(content)).toBe(true);
  });

  it('is empty for anything else', () => {
    expect(getMcpUiResources(undefined)).toEqual([]);
    expect(hasMcpUiResource([{ text: 'x', type: 'text' }])).toBe(false);
  });
});

describe('describeMcpUiResourceBlock', () => {
  it('names the view without its HTML', () => {
    const summary = describeMcpUiResourceBlock(html({ text: '<script>secret()</script>' }));
    expect(summary).toBe('<resource type="ui" uri="ui://demo/card" mimeType="text/html" />');
    expect(summary).not.toContain('secret');
  });

  it('leaves other resources to the default serializer', () => {
    expect(
      describeMcpUiResourceBlock({ resource: { text: 'x', uri: 'file:///a' }, type: 'resource' }),
    ).toBeUndefined();
  });
});
