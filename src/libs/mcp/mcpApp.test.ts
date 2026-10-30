import { describe, expect, it } from 'vitest';

import { getMcpAppFromState, getToolUiResourceUri, unwrapMcpToolState } from './mcpApp';

describe('getToolUiResourceUri', () => {
  it('reads the nested and the deprecated flat key', () => {
    expect(getToolUiResourceUri({ _meta: { ui: { resourceUri: 'ui://a' } } })).toBe('ui://a');
    expect(getToolUiResourceUri({ _meta: { 'ui/resourceUri': 'ui://b' } })).toBe('ui://b');
  });

  it('ignores missing and non-ui:// URIs', () => {
    expect(getToolUiResourceUri({})).toBeUndefined();
    expect(getToolUiResourceUri({ _meta: { ui: { resourceUri: 'https://x' } } })).toBeUndefined();
  });
});

describe('getMcpAppFromState', () => {
  it('returns the stored view reference', () => {
    expect(getMcpAppFromState({ content: [], mcpApp: { resourceUri: 'ui://a' } })).toEqual({
      resourceUri: 'ui://a',
    });
  });

  it('finds the reference in server AgentRuntime results, nested one level deeper', () => {
    const state = {
      content: 'sunny',
      state: { content: [], mcpApp: { resourceUri: 'ui://a' } },
      success: true,
    };

    expect(getMcpAppFromState(state)).toEqual({ resourceUri: 'ui://a' });
    expect(unwrapMcpToolState(state)).toBe(state.state);
  });

  it('ignores states without a valid reference', () => {
    expect(getMcpAppFromState(undefined)).toBeUndefined();
    expect(getMcpAppFromState({ mcpApp: { resourceUri: 'javascript:alert(1)' } })).toBeUndefined();
  });
});
