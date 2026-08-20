import { describe, expect, it } from 'vitest';

import { resolveConversationMode } from './conversationMode';

describe('resolveConversationMode', () => {
  it('keeps shared-agent visitors on a non-interactive welcome surface', () => {
    expect(resolveConversationMode('share-1')).toEqual({ readOnly: true, showComposer: false });
  });

  it('keeps the owner conversation interactive', () => {
    expect(resolveConversationMode()).toEqual({ readOnly: false, showComposer: true });
  });
});
