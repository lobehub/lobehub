import { DEFAULT_AVATAR, DEFAULT_INBOX_AVATAR } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import { resolveOverlayAgentOptions, resolveOverlayDefaultAgentId } from './overlaySnapshot';

describe('overlaySnapshot', () => {
  it('prepends inbox when the home agent list does not contain it', () => {
    const agentOptions = resolveOverlayAgentOptions({
      agents: [{ avatar: 'A', id: 'agent-1', title: 'Agent 1' }],
      inboxAgentId: 'inbox-agent',
      inboxMeta: { title: null },
    });

    expect(agentOptions).toEqual([
      {
        avatar: DEFAULT_INBOX_AVATAR,
        backgroundColor: undefined,
        id: 'inbox-agent',
        title: 'Lobe AI',
      },
      {
        avatar: 'A',
        backgroundColor: undefined,
        id: 'agent-1',
        title: 'Agent 1',
      },
    ]);
  });

  it('falls back to inbox when the active agent is not selectable in overlay', () => {
    const agentOptions = resolveOverlayAgentOptions({
      agents: [{ avatar: 'A', id: 'agent-1', title: 'Agent 1' }],
      inboxAgentId: 'inbox-agent',
      inboxMeta: { avatar: '🤖', title: 'Lobe AI' },
    });

    const defaultAgentId = resolveOverlayDefaultAgentId({
      activeAgentId: 'missing-agent',
      agentOptions,
      inboxAgentId: 'inbox-agent',
    });

    expect(defaultAgentId).toBe('inbox-agent');
  });

  it('keeps the current active agent when it is already present in overlay options', () => {
    const agentOptions = resolveOverlayAgentOptions({
      agents: [
        { avatar: 'A', id: 'agent-1', title: 'Agent 1' },
        { avatar: 'B', id: 'agent-2', title: 'Agent 2' },
      ],
      inboxAgentId: 'inbox-agent',
    });

    const defaultAgentId = resolveOverlayDefaultAgentId({
      activeAgentId: 'agent-2',
      agentOptions,
      inboxAgentId: 'inbox-agent',
    });

    expect(defaultAgentId).toBe('agent-2');
  });

  it('applies App fallback title and avatar for untitled agents', () => {
    const agentOptions = resolveOverlayAgentOptions({
      agents: [{ avatar: null, id: 'agent-1', title: '' }],
    });

    expect(agentOptions).toEqual([
      {
        avatar: DEFAULT_AVATAR,
        backgroundColor: undefined,
        id: 'agent-1',
        title: 'Untitled Agent',
      },
    ]);
  });
});
