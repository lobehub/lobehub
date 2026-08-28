/**
 * @vitest-environment happy-dom
 */
import { render, renderHook, screen } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SelectionFooterBar from '@/features/Conversation/MessageForward/SelectionFooterBar';

import { useActionsBarConfig } from './useActionsBarConfig';

const agentState = vi.hoisted(() => ({ isHeterogeneous: false }));
const conversationState = vi.hoisted(() => ({
  deleteMessages: vi.fn(),
  exitSelectionMode: vi.fn(),
  selectedMessageIds: ['message-1'],
}));

vi.mock('@/features/Conversation/MessageForward/ForwardModal', () => ({
  openForwardModal: vi.fn(),
}));

vi.mock('@/features/Conversation/store', () => ({
  messageStateSelectors: {
    selectedMessageCount: (state: typeof conversationState) => state.selectedMessageIds.length,
  },
  useConversationStore: (selector: (state: typeof conversationState) => unknown) =>
    selector(conversationState),
  useConversationStoreApi: () => ({}),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: typeof agentState) => unknown) => selector(agentState),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentSelectors: {
    isCurrentAgentHeterogeneous: (state: typeof agentState) => state.isHeterogeneous,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('useActionsBarConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.isHeterogeneous = false;
  });

  it('keeps the ordinary-agent defaults', () => {
    const { result } = renderHook(() => useActionsBarConfig());

    expect(result.current).toEqual({});
  });

  it('omits delete from every heterogeneous-agent message menu', () => {
    agentState.isHeterogeneous = true;
    const { result } = renderHook(() => useActionsBarConfig());

    expect(result.current.user?.menu).not.toContain('del');
    expect(result.current.assistant?.menu).not.toContain('del');
    expect(result.current.assistantGroup?.menu).not.toContain('del');
  });

  it('keeps selection-mode actions available for ordinary agents', () => {
    render(createElement(SelectionFooterBar));

    expect(screen.getByRole('button', { name: 'messageForward.bar.cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'messageForward.bar.delete' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'messageForward.bar.forward' })).toBeEnabled();
  });

  it('omits selection-mode delete while keeping forwarding for heterogeneous agents', () => {
    agentState.isHeterogeneous = true;
    render(createElement(SelectionFooterBar));

    expect(screen.getByRole('button', { name: 'messageForward.bar.cancel' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'messageForward.bar.delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'messageForward.bar.forward' })).toBeEnabled();
  });
});
