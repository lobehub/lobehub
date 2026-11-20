import { describe, expect, it } from 'vitest';

import { topicPreviewText } from './topicPreview';

describe('topicPreviewText', () => {
  it('reads a webhook call as its webhook name and request body', () => {
    const raw = [
      '<webhookEvent webhookId="wh-1" name="CI 告警" thread="PR-7">',
      '<event id="s1" timestamp="2026-11-13T08:00:00Z">{"body":{"build":42},"headers":{"user-agent":"curl"}}</event>',
      '<guidance>Never shown.</guidance>',
      '</webhookEvent>',
    ].join('\n');
    expect(topicPreviewText(raw)).toBe('CI 告警: {"build":42}');
  });

  it('shows a text body as written, unescaped', () => {
    expect(
      topicPreviewText(
        '<webhookEvent webhookId="w" name="Ops">\n<event id="s">{"body":"disk &lt;90%&gt; full","headers":{}}</event>',
      ),
    ).toBe('Ops: disk <90%> full');
  });

  it('keeps as much of a sliced first message as arrived', () => {
    expect(
      topicPreviewText(
        '<webhookEvent webhookId="w" name="Ops">\n<event id="s">{"body":"long text cut',
      ),
    ).toBe('Ops: {"body":"long text cut');
  });

  it('reads an MCP event as its connector and event data', () => {
    expect(
      topicPreviewText(
        '<mcpEvent connector="linear" connectorName="Linear" event="issue.created" webhookId="w">\n<event id="e1" timestamp="t">{"issue":"LIN-1"}</event>',
      ),
    ).toBe('Linear: {"issue":"LIN-1"}');
  });

  it('leaves an ordinary message alone', () => {
    expect(topicPreviewText('Please review <b>this</b>')).toBe('Please review <b>this</b>');
  });
});
