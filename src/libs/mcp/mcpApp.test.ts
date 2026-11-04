import { describe, expect, it } from 'vitest';

import {
  canServeMcpAppHere,
  getMcpAppFromState,
  getToolUiResourceUri,
  isToolVisibleToApp,
  unwrapMcpToolState,
} from './mcpApp';

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

  it('never unwraps a state a server nested in its own result', () => {
    // A client call's state is the server's result; the SDK keeps its extra fields
    const serverResult = {
      content: [{ text: 'ok', type: 'text' }],
      state: {
        content: [{ data: '/api/auth/get-session', mimeType: 'image/png', type: 'image' }],
        mcpApp: { resourceUri: 'ui://forged' },
      },
    };

    expect(unwrapMcpToolState(serverResult)).toBe(serverResult);
    expect(getMcpAppFromState(serverResult)).toBeUndefined();
  });

  it('ignores states without a valid reference', () => {
    expect(getMcpAppFromState(undefined)).toBeUndefined();
    expect(getMcpAppFromState({ mcpApp: { resourceUri: 'javascript:alert(1)' } })).toBeUndefined();
  });
});

describe('isToolVisibleToApp', () => {
  it('follows _meta.ui.visibility, which defaults to model and app', () => {
    expect(isToolVisibleToApp({ _meta: { ui: { visibility: ['model'] } } })).toBe(false);
    expect(isToolVisibleToApp({ _meta: { ui: { visibility: [] } } })).toBe(false);
    expect(isToolVisibleToApp({ _meta: { ui: { visibility: ['app'] } } })).toBe(true);
    expect(isToolVisibleToApp({ _meta: { ui: {} } })).toBe(true);
    expect(isToolVisibleToApp({})).toBe(true);
  });
});

describe('MCP App views from a desktop', () => {
  it('reads the desktop that produced a local view', () => {
    expect(
      getMcpAppFromState({ content: [], mcpApp: { deviceId: 'dev-a', resourceUri: 'ui://a' } }),
    ).toEqual({ deviceId: 'dev-a', resourceUri: 'ui://a' });
  });

  it('serves a local view only on the desktop that produced it', () => {
    const local = { deviceId: 'dev-a', resourceUri: 'ui://a' };

    expect(canServeMcpAppHere(local, 'dev-a')).toBe(true);
    expect(canServeMcpAppHere(local, 'dev-b')).toBe(false);
    // Web, or a desktop that can't tell which one it is
    expect(canServeMcpAppHere(local, undefined)).toBe(false);
    expect(canServeMcpAppHere(local, null)).toBe(false);
    // A view the server reads is served anywhere
    expect(canServeMcpAppHere({ resourceUri: 'ui://a' }, undefined)).toBe(true);
  });
});
