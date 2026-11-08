import { afterEach, describe, expect, it, vi } from 'vitest';

import { draftRepairPromptInMobile } from './mobileBridge';

const installBridge = (bridge?: object) => {
  const page = { ReactNativeWebView: bridge, top: undefined as unknown };
  page.top = page;
  vi.stubGlobal('window', page);
};

afterEach(() => vi.unstubAllGlobals());

describe('draftRepairPromptInMobile', () => {
  it('hands the exact repair prompt to a capable native client', () => {
    const postMessage = vi.fn();
    installBridge({
      injectedObjectJson: () => JSON.stringify({ acceptanceDraftVersion: 1 }),
      postMessage,
    });
    expect(draftRepairPromptInMobile('review-1', 'Fix this\n请修改')).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      acceptanceId: 'review-1',
      text: 'Fix this\n请修改',
      type: 'acceptance.draftRepairPrompt',
      version: 1,
    });
  });

  it.each([
    undefined,
    { postMessage: vi.fn() },
    { injectedObjectJson: () => 'invalid', postMessage: vi.fn() },
    { injectedObjectJson: () => '{"acceptanceDraftVersion":2}', postMessage: vi.fn() },
    {
      injectedObjectJson: () => '{"acceptanceDraftVersion":1}',
      postMessage: () => {
        throw new Error('bridge unavailable');
      },
    },
  ])('falls back to clipboard in browsers, old clients and on bridge failure', (bridge) => {
    installBridge(bridge);
    expect(draftRepairPromptInMobile('review-1', 'Fix this')).toBe(false);
  });

  it('does not dispatch from an embedded frame', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {
      ReactNativeWebView: {
        injectedObjectJson: () => '{"acceptanceDraftVersion":1}',
        postMessage,
      },
      top: {},
    });
    expect(draftRepairPromptInMobile('review-1', 'Fix this')).toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
