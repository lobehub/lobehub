import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { channelService } from '@/services/channel';
import { channelActions } from '@/store/channel';

import type { ChannelMentionInvite } from './mentions';
import { useMentionInvites } from './useMentionInvites';

const { agentDraft } = vi.hoisted(() => ({
  agentDraft: { issue: undefined as string | undefined },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));
vi.mock('@/components/AgentAvatar', () => ({ default: () => null }));
vi.mock('@/components/Avatar', () => ({ default: () => null }));
vi.mock('@/store/device/useDeviceList', () => ({ useDeviceList: () => ({}) }));
vi.mock('./CreateChannel/useChannelAgentOptions', () => ({
  useChannelAgentOptions: () => ({
    agents: [
      { id: 'agt_writer', title: 'Writer' },
      { id: 'agt_project', title: 'Project writer' },
      { id: 'agt_joined', title: 'Joined writer' },
    ],
    projectAgentIds: ['agt_project'],
  }),
}));
// The invite dialog's environment resolution, settled with the issue the test sets.
vi.mock('./CreateChannel/useChannelAgentDraft', () => ({
  useChannelAgentDraft: (draft: { agentId: string }) => ({
    draft: agentDraft.issue
      ? { ...draft, initialized: false, issue: agentDraft.issue }
      : { ...draft, deviceId: 'dev_1', initialized: true, issue: undefined },
  }),
}));

const channel: ChannelListItem = {
  agentId: null,
  canDelete: true,
  createdAt: new Date(0),
  id: 'chn_abcdefghijkl',
  projectId: null,
  sequence: 0,
  status: 'active',
  title: 'Team',
  workspaceId: 'ws_1',
};

const joinedAgent = {
  actorType: 'agent',
  agentId: 'agt_joined',
  id: 'mem_joined',
  status: 'active',
} as ChannelPublicMember;

const target = (actorType: 'agent' | 'user', id: string): ChannelMentionInvite => ({
  actorType,
  id,
  name: `Name ${id}`,
  type: 'channel-invite',
});

const setup = (current: ChannelListItem = channel, members = [joinedAgent]) => {
  const hook = renderHook(() => useMentionInvites(current, members));
  // Hidden Agent environment resolution mounts beside the editor.
  const drafts = () => createElement(Fragment, null, hook.result.current.agentDrafts);
  const view = render(drafts());
  return { ...hook, rerenderDrafts: () => view.rerender(drafts()) };
};

describe('@mentions that invite people and Agents from outside the Channel', () => {
  beforeEach(() => {
    agentDraft.issue = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(channelService, 'userCandidates').mockResolvedValue([
      { avatar: null, fullName: 'Writer Lin', userId: 'user_lin', username: 'lin' },
    ]);
    vi.spyOn(channelActions, 'addMember').mockImplementation(async (_, member) =>
      'userId' in member ? `mem_${member.userId}` : `mem_${member.agent.agentId}`,
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('suggests matching outsiders only once a name is typed', async () => {
    const { result } = setup();
    expect(await result.current.options('')).toEqual([]);
    const options = await result.current.options('writer');
    expect(options.map((option) => option.metadata)).toEqual([
      { actorType: 'user', id: 'user_lin', name: 'Writer Lin', type: 'channel-invite' },
      // The project's own Agent first; Agents already in the Channel are left out.
      { actorType: 'agent', id: 'agt_project', name: 'Project writer', type: 'channel-invite' },
      { actorType: 'agent', id: 'agt_writer', name: 'Writer', type: 'channel-invite' },
    ]);
    expect(channelService.userCandidates).toHaveBeenCalledExactlyOnceWith(channel.id, 'writer');
  });

  it('searches people only for the query typing settled on', async () => {
    const { result } = setup();
    const [first, second] = await Promise.all([
      result.current.options('wri'),
      result.current.options('writer'),
    ]);
    expect(first.filter((option) => option.metadata.actorType === 'user')).toEqual([]);
    expect(second.map((option) => option.metadata.id)).toContain('user_lin');
    expect(channelService.userCandidates).toHaveBeenCalledExactlyOnceWith(channel.id, 'writer');
  });

  it('stops suggesting someone once they joined, even from a cached search', async () => {
    const lin = { actorType: 'user', id: 'mem_lin', status: 'active', userId: 'user_lin' };
    const { result, rerender } = renderHook(({ members }) => useMentionInvites(channel, members), {
      initialProps: { members: [joinedAgent] },
    });
    expect((await result.current.options('writer')).map((o) => o.metadata.id)).toContain(
      'user_lin',
    );
    rerender({ members: [joinedAgent, lin as ChannelPublicMember] });
    expect((await result.current.options('writer')).map((o) => o.metadata.id)).not.toContain(
      'user_lin',
    );
  });

  it('leaves an invite chip as plain text where no one can be invited', async () => {
    const { result } = setup({ ...channel, agentId: 'agt_direct' });
    await expect(
      result.current.resolve([target('user', 'user_lin'), target('agent', 'agt_joined')]),
    ).resolves.toEqual(['mem_joined']);
    expect(channelActions.addMember).not.toHaveBeenCalled();
    expect(result.current.error).toBe('');
  });

  it.each([
    ['someone who cannot invite', { canDelete: false }],
    ['an archived Channel', { status: 'archived' as const }],
    ['a direct conversation', { agentId: 'agt_direct' }],
  ])('suggests no outsiders in %s', async (_, patch) => {
    const { result } = setup({ ...channel, ...patch });
    expect(result.current.enabled).toBe(false);
    expect(await result.current.options('writer')).toEqual([]);
  });

  it('offers only Agents in a personal Channel, where people cannot join', async () => {
    const { result } = setup({ ...channel, workspaceId: null });
    const options = await result.current.options('writer');
    expect(options.map((option) => option.metadata.actorType)).toEqual(['agent', 'agent']);
    expect(channelService.userCandidates).not.toHaveBeenCalled();
  });

  it('adds a mentioned person once and resolves the message mention to the new member', async () => {
    const { result } = setup();
    act(() => {
      result.current.invite(target('user', 'user_lin'));
    });
    await expect(result.current.resolve([target('user', 'user_lin')])).resolves.toEqual([
      'mem_user_lin',
    ]);
    expect(channelActions.addMember).toHaveBeenCalledExactlyOnceWith(channel.id, {
      userId: 'user_lin',
    });
  });

  it('does not re-add someone who is already a member', async () => {
    const { result } = setup();
    await expect(result.current.resolve([target('agent', 'agt_joined')])).resolves.toEqual([
      'mem_joined',
    ]);
    expect(channelActions.addMember).not.toHaveBeenCalled();
  });

  it("adds an Agent with the invite dialog's environment defaults", async () => {
    const { result, rerenderDrafts } = setup();
    let resolved: Promise<string[] | undefined>;
    act(() => {
      resolved = result.current.resolve([target('agent', 'agt_writer')]);
    });
    rerenderDrafts();
    await expect(resolved!).resolves.toEqual(['mem_agt_writer']);
    expect(channelActions.addMember).toHaveBeenCalledExactlyOnceWith(channel.id, {
      agent: { agentId: 'agt_writer', deviceId: 'dev_1' },
    });
  });

  it('reports an Agent whose environment blocks it, and the message is not sent', async () => {
    agentDraft.issue = 'deviceOffline';
    const { result, rerenderDrafts } = setup();
    let resolved: Promise<string[] | undefined>;
    act(() => {
      resolved = result.current.resolve([target('agent', 'agt_writer')]);
    });
    rerenderDrafts();
    await expect(resolved!).resolves.toBeUndefined();
    expect(channelActions.addMember).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.error).toContain('environment.inherited.deviceOffline'),
    );
  });

  it('gives up on an Agent whose settings never finish loading', async () => {
    vi.useFakeTimers();
    try {
      agentDraft.issue = 'devicesLoading';
      const { result, rerenderDrafts } = setup();
      let resolved: Promise<string[] | undefined>;
      act(() => {
        resolved = result.current.resolve([target('agent', 'agt_writer')]);
      });
      rerenderDrafts();
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      await expect(resolved!).resolves.toBeUndefined();
      expect(channelActions.addMember).not.toHaveBeenCalled();
      expect(result.current.error).toContain('environment.configurationFailed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed add and retries it when the message is sent', async () => {
    vi.mocked(channelActions.addMember).mockRejectedValueOnce(new Error('offline'));
    const { result } = setup();
    await expect(result.current.resolve([target('user', 'user_lin')])).resolves.toBeUndefined();
    await waitFor(() => expect(result.current.error).toContain('mentionInvite.failed'));
    await expect(result.current.resolve([target('user', 'user_lin')])).resolves.toEqual([
      'mem_user_lin',
    ]);
    expect(channelActions.addMember).toHaveBeenCalledTimes(2);
  });
});
