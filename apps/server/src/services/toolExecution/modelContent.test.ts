import { describe, expect, it } from 'vitest';

import { toModelContent } from './modelContent';

describe('toModelContent', () => {
  it('gives the text only for an MCP App result', () => {
    expect(
      toModelContent({
        content: 'Found 1 row',
        state: { content: [], mcpApp: { resourceUri: 'ui://rows' }, structuredContent: { a: 1 } },
        success: true,
      }),
    ).toBe('Found 1 row');
  });

  it('keeps structured output but not the HTML of embedded MCP-UI views', () => {
    const card = {
      resource: { mimeType: 'text/html', text: '<button>secret-html</button>', uri: 'ui://card' },
      type: 'resource',
    };
    const content = toModelContent({
      content: 'Card ready',
      state: {
        _meta: { view: 'only' },
        content: [{ text: 'Card ready', type: 'text' }, card],
        mcpUi: { server: 'srv' },
        structuredContent: { temperature: 20 },
      },
      success: true,
    });

    const model = JSON.parse(content);
    expect(model.state.structuredContent).toEqual({ temperature: 20 });
    expect(model.state.mcpUi).toBeUndefined();
    expect(model.state._meta).toBeUndefined();
    expect(content).not.toContain('secret-html');
    expect(model.state.content[1]).toEqual({
      text: '<resource type="ui" uri="ui://card" mimeType="text/html" />',
      type: 'text',
    });
  });

  it('serializes any other result without _meta', () => {
    const model = JSON.parse(
      toModelContent({ content: '', state: { _meta: { x: 1 }, content: [] }, success: true }),
    );
    expect(model.state).toEqual({ content: [] });
  });
});
