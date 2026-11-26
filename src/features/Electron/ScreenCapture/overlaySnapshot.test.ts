import { DEFAULT_INBOX_AVATAR, DEFAULT_INBOX_TITLE } from '@lobechat/const';
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
        title: DEFAULT_INBOX_TITLE,
      },
      {
        avatar: 'A',
        backgroundColor: undefined,
        id: 'agent-1',
        title: 'Agent 1',
      },
    ]);
  });

  // The overlay draws emoji and images only; it showed the picked value's first letter.
  it('hands the overlay no picked Agent character', () => {
    const [inbox, agent] = resolveOverlayAgentOptions({
      agents: [{ avatar: 'agent-avatar:cat:green', id: 'agent-1', title: 'Agent 1' }],
      inboxAgentId: 'inbox-agent',
      inboxMeta: { avatar: 'agent-avatar:rocket:cyan', title: null },
    });

    expect(inbox.avatar).toBe(DEFAULT_INBOX_AVATAR);
    expect(agent.avatar).toBeUndefined();
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
        avatar: undefined,
        backgroundColor: undefined,
        id: 'agent-1',
        title: 'Untitled Agent',
      },
    ]);
  });

  it('preserves heterogeneousType for overlay agent options', () => {
    const agentOptions = resolveOverlayAgentOptions({
      agents: [{ avatar: 'A', heterogeneousType: 'codex', id: 'agent-1', title: 'Agent 1' }],
    });

    expect(agentOptions).toEqual([
      {
        avatar: 'A',
        backgroundColor: undefined,
        heterogeneousType: 'codex',
        id: 'agent-1',
        title: 'Agent 1',
      },
    ]);
  });
});
