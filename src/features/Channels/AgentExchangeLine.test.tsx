/**
 * @vitest-environment happy-dom
 */
import type { ChannelPublicMessage } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AgentExchangeLine, exchangeAgentOf } from './AgentExchangeLine';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-i18next', () => ({
  Trans: ({ components, i18nKey }: { components: { agent: ReactNode }; i18nKey: string }) =>
    createElement('span', { 'data-key': i18nKey }, components.agent),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => navigate,
}));
vi.mock('@/features/AgentProfileCard/AgentProfilePopup', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/AgentAvatar', () => ({
  default: ({ agentId }: { agentId?: string }) =>
    createElement('span', { 'data-agent-id': agentId, 'data-testid': 'agent-avatar' }),
}));

const report = (patch: Partial<ChannelPublicMessage> = {}) =>
  ({
    author: { avatar: null, id: 'agt_asker', name: 'Sanjo', type: 'agent' },
    receipt: {
      agent: { agentId: 'agt_answerer', avatar: null, name: 'Xiao C' },
      channelId: 'chn_pair',
      channelTitle: 'Sanjo · Xiao C',
      messageId: 'msg_2',
    },
    via: null,
    ...patch,
  }) as ChannelPublicMessage;

describe('AgentExchangeLine', () => {
  it('names the answering Agent and opens the conversation between the Agents', () => {
    render(<AgentExchangeLine message={report()} />);

    expect(screen.getByText('Xiao C')).toBeTruthy();
    expect(screen.getByTestId('agent-avatar').dataset.agentId).toBe('agt_answerer');
    fireEvent.click(screen.getByText('events.agentExchangeOpen'));
    expect(navigate).toHaveBeenCalledWith('/channels/chn_pair');
  });

  it('applies only to an Agent report that is not a relay receipt', () => {
    expect(exchangeAgentOf(report())?.name).toBe('Xiao C');
    expect(
      exchangeAgentOf(report({ author: { avatar: null, id: 'u', name: 'P', type: 'user' } })),
    ).toBeUndefined();
    expect(
      exchangeAgentOf(report({ via: { agentId: 'agt_x', avatar: null, name: 'X' } as never })),
    ).toBeUndefined();
    expect(exchangeAgentOf(report({ receipt: null }))).toBeUndefined();
  });
});
