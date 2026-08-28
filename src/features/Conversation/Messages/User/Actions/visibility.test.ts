import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { LOCAL_MESSAGE_SCOPE } from '@/store/chat/utils/localMessages';

import { shouldShowUserActions } from './visibility';

const createMessage = (metadata?: UIChatMessage['metadata']) =>
  ({ id: 'message-1', metadata, role: 'user' }) as UIChatMessage;

describe('shouldShowUserActions', () => {
  it('shows actions for persisted user messages', () => {
    expect(shouldShowUserActions(createMessage())).toBe(true);
  });

  it('hides actions for local-only optimistic messages', () => {
    expect(shouldShowUserActions(createMessage({ scope: LOCAL_MESSAGE_SCOPE }))).toBe(false);
  });
});
