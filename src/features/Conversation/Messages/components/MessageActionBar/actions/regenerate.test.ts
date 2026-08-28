/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { regenerateAction } from './regenerate';

const regenerateUserMessage = vi.fn();
const regenerateAssistantMessage = vi.fn();
const delAndRegenerateMessage = vi.fn();
const deleteMessage = vi.fn();

vi.mock('../../../../store', () => ({
  messageStateSelectors: {
    isMessageRegenerating: () => () => false,
  },
  useConversationStore: (selector: (s: any) => any) =>
    selector({
      delAndRegenerateMessage,
      deleteMessage,
      regenerateAssistantMessage,
      regenerateUserMessage,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = (
  data: Partial<UIChatMessage>,
  role: MessageActionContext['role'] = 'assistant',
  id = 'msg-1',
) =>
  renderHook(() => regenerateAction.useBuild({ data: data as UIChatMessage, id, role })).result
    .current!;

describe('regenerateAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: this used to fire `regenerateAssistantMessage` WITHOUT awaiting
  // it and then call `deleteMessage` on the same tick. The unawaited regenerate
  // computes its new branch index from the pre-delete child count, so the index
  // lands out of range once the delete resolves; and the delete itself silently
  // misses, because regenerate has already switched the branch away from the
  // message it is trying to remove. `delAndRegenerateMessage` is the ordering
  // that works — delete first, then regenerate.
  it('replaces a failed assistant turn through the delete-first path', () => {
    build({ error: { type: 'ProviderBizError' } } as any).handleClick!();

    expect(delAndRegenerateMessage).toHaveBeenCalledWith('msg-1');
    expect(regenerateAssistantMessage).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('regenerates a healthy assistant turn without deleting it', () => {
    build({} as any).handleClick!();

    expect(regenerateAssistantMessage).toHaveBeenCalledWith('msg-1');
    expect(delAndRegenerateMessage).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it('leaves the user-message path untouched', () => {
    build({ error: { type: 'ProviderBizError' } } as any, 'user').handleClick!();

    expect(regenerateUserMessage).toHaveBeenCalledWith('msg-1');
    expect(deleteMessage).toHaveBeenCalledWith('msg-1');
    expect(delAndRegenerateMessage).not.toHaveBeenCalled();
  });
});
