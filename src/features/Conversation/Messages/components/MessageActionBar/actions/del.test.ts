/**
 * @vitest-environment happy-dom
 */
import type { UIChatMessage } from '@lobechat/types';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageActionContext } from '../types';
import { delAction } from './del';

const deleteMessage = vi.fn();
const agentState = vi.hoisted(() => ({ isHeterogeneous: false }));

vi.mock('../../../../store', () => ({
  useConversationStore: (selector: (s: { deleteMessage: typeof deleteMessage }) => unknown) =>
    selector({ deleteMessage }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: typeof agentState) => unknown) => selector(agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: (s: typeof agentState) => s.isHeterogeneous,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const build = (
  data: Partial<UIChatMessage>,
  role: MessageActionContext['role'] = 'assistant',
  id = 'message-1',
) => renderHook(() => delAction.useBuild({ data: data as UIChatMessage, id, role })).result.current;

describe('delAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.isHeterogeneous = false;
  });

  it('hides delete for heterogeneous-agent messages', () => {
    agentState.isHeterogeneous = true;

    expect(build({ content: 'CLI-owned turn' })).toBeNull();
  });

  it('keeps delete available for ordinary-agent messages', () => {
    build({ content: 'regular turn' })!.handleClick!();

    expect(deleteMessage).toHaveBeenCalledWith('message-1');
  });
});
