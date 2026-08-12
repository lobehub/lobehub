import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';

import { getMessageInteractionState } from './messageInteraction';

const createMessage = (metadata?: UIChatMessage['metadata']) =>
  ({ id: 'message-1', metadata, role: 'user' }) as UIChatMessage;

describe('getMessageInteractionState', () => {
  it('keeps persisted messages interactive by default', () => {
    expect(getMessageInteractionState(createMessage())).toEqual({
      effectiveDisableEditing: false,
      shouldSuppressContextMenu: false,
    });
  });

  it('retains an explicit editing restriction without suppressing the context menu', () => {
    expect(getMessageInteractionState(createMessage(), true)).toEqual({
      effectiveDisableEditing: true,
      shouldSuppressContextMenu: false,
    });
  });

  it('disables editing and suppresses the context menu for local-only messages', () => {
    expect(getMessageInteractionState(createMessage({ scope: LOCAL_MESSAGE_SCOPE }))).toEqual({
      effectiveDisableEditing: true,
      shouldSuppressContextMenu: true,
    });
  });
});
