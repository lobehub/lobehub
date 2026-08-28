// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { isChatInputDropTarget } from './useConversationPanelDrop';

describe('isChatInputDropTarget', () => {
  it('keeps drops inside the chat input out of the split-view target', () => {
    const chatInput = document.createElement('div');
    chatInput.dataset.testid = 'chat-input';
    const editor = document.createElement('div');
    chatInput.append(editor);

    expect(isChatInputDropTarget(editor)).toBe(true);
  });

  it('allows drops in the chat list to open the split view', () => {
    const chatList = document.createElement('div');

    expect(isChatInputDropTarget(chatList)).toBe(false);
  });
});
