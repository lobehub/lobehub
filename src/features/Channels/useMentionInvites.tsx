import { DEFAULT_USER_AVATAR } from '@lobechat/const';
import type { ChannelListItem, ChannelPublicMember } from '@lobechat/types';
import { agentDisplayName } from '@lobechat/types';
import type { ISlashMenuOption } from '@lobehub/editor';
import { useLatest } from 'ahooks';
import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import Avatar from '@/components/Avatar';
import { useSingleton } from '@/hooks/useSingleton';
import type { ChannelAgentSelection, ChannelPersonOption } from '@/services/channel';
import { channelService } from '@/services/channel';
import { channelActions } from '@/store/channel';
import type { DeviceListResult } from '@/store/device/useDeviceList';
import { useDeviceList } from '@/store/device/useDeviceList';

import { canInviteMembers } from './channelAccess';
import type { ChannelAgentDraft, ChannelAgentIssue } from './CreateChannel/agentEnvironment';
import { channelAgentIssueKey, toChannelAgentSelection } from './CreateChannel/agentEnvironment';
import { getChannelSaveErrorKey } from './CreateChannel/saveError';
import { useChannelAgentDraft } from './CreateChannel/useChannelAgentDraft';
import { useChannelAgentOptions } from './CreateChannel/useChannelAgentOptions';
import { matchInviteAgents, MENTION_INVITE_LIMIT } from './mentionGroups';
import type { ChannelMentionInvite } from './mentions';

/** Like a chosen Agent in the invite dialog: it keeps its own device and directory. */
const INHERITED = { directoryOptional: true };
/** Issues that clear once loading finishes; any other issue blocks the invite. */
const LOADING_ISSUES = new Set<ChannelAgentIssue>(['configurationLoading', 'devicesLoading']);
/** A send waits this long for an Agent's settings and devices before giving up. */
const AGENT_RESOLVE_TIMEOUT_MS = 30_000;
/** Typing pauses this long before people are searched, like the invite dialog. */
const PEOPLE_SEARCH_DEBOUNCE_MS = 200;

class AgentIssueError extends Error {
  constructor(readonly issue: ChannelAgentIssue) {
    super(issue);
  }
}

const inviteKey = ({ actorType, id }: Pick<ChannelMentionInvite, 'actorType' | 'id'>) =>
  `${actorType}:${id}`;

/** Resolves one Agent's environment with the invite dialog's defaults, without showing it. */
const AgentDraft = ({
  devices,
  draft,
  onSettle,
  setDrafts,
}: {
  devices: DeviceListResult;
  draft: ChannelAgentDraft;
  onSettle: (draft: ChannelAgentDraft) => void;
  setDrafts: Dispatch<SetStateAction<ChannelAgentDraft[]>>;
}) => {
  const { draft: resolved } = useChannelAgentDraft(draft, devices, setDrafts, INHERITED);
  const settled = resolved.issue ? !LOADING_ISSUES.has(resolved.issue) : resolved.initialized;
  useEffect(() => {
    if (settled) onSettle(resolved);
  }, [onSettle, resolved, settled]);
  return null;
};

const AgentDrafts = ({
  drafts,
  onSettle,
  setDrafts,
}: {
  drafts: ChannelAgentDraft[];
  onSettle: (draft: ChannelAgentDraft) => void;
  setDrafts: Dispatch<SetStateAction<ChannelAgentDraft[]>>;
}) => {
  const devices = useDeviceList({ refreshInterval: 15_000 });
  return drafts.map((draft) => (
    <AgentDraft
      devices={devices}
      draft={draft}
      key={draft.agentId}
      setDrafts={setDrafts}
      onSettle={onSettle}
    />
  ));
};

/**
 * An @mention can reach people and Agents outside the Channel: typing a name lists the
 * matching workspace members and Agents, and choosing one adds them to the Channel, exactly
 * as the invite dialog would. Only someone who may invite sees them, and never in a direct
 * conversation, which stays one person and one Agent.
 */
export const useMentionInvites = (
  channel: ChannelListItem | undefined,
  members: ChannelPublicMember[],
) => {
  const { t } = useTranslation('channel');
  const enabled = !!channel && !channel.agentId && canInviteMembers(channel);
  const agentOptions = useChannelAgentOptions(
    enabled ? (channel.projectId ?? undefined) : undefined,
  );
  const [drafts, setDrafts] = useState<ChannelAgentDraft[]>([]);
  const [error, setError] = useState('');
  // The editor keeps the mention callbacks it was first given, so they read the latest render.
  const latest = useLatest({ agentOptions, channel, enabled, members });
  const running = useSingleton(() => new Map<string, Promise<string | undefined>>());
  const people = useSingleton(() => new Map<string, Promise<ChannelPersonOption[]>>());
  const latestQuery = useRef('');
  const agentWaiters = useSingleton(
    () =>
      new Map<
        string,
        { reject: (error: unknown) => void; resolve: (agent: ChannelAgentSelection) => void }
      >(),
  );

  const settleAgent = useSingleton(() => (draft: ChannelAgentDraft) => {
    const waiter = agentWaiters.get(draft.agentId);
    if (!waiter) return;
    agentWaiters.delete(draft.agentId);
    setDrafts((current) => current.filter((item) => item.agentId !== draft.agentId));
    if (draft.issue) waiter.reject(new AgentIssueError(draft.issue));
    else waiter.resolve(toChannelAgentSelection(draft));
  });

  const resolveAgent = (agentId: string) =>
    new Promise<ChannelAgentSelection>((resolve, reject) => {
      // Settings or device presence that never finish loading must not hold a send forever.
      const timer = setTimeout(
        () => settleAgent({ agentId, initialized: false, issue: 'configurationFailed' }),
        AGENT_RESOLVE_TIMEOUT_MS,
      );
      agentWaiters.set(agentId, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (agent) => {
          clearTimeout(timer);
          resolve(agent);
        },
      });
      setDrafts((current) => [
        ...current.filter((item) => item.agentId !== agentId),
        { agentId, initialized: false, issue: 'configurationLoading' },
      ]);
    });

  /**
   * Each search takes the Channel lock on the server, so only the query typing settled on is
   * searched; an earlier one resolves empty because the editor already dropped it.
   */
  const searchPeople = async (channelId: string, query: string) => {
    const key = `${channelId}:${query}`;
    latestQuery.current = query;
    let result = people.get(key);
    if (!result) {
      await new Promise((resolve) => setTimeout(resolve, PEOPLE_SEARCH_DEBOUNCE_MS));
      if (latestQuery.current !== query) return [];
      result = people.get(key);
    }
    if (!result) {
      result = channelService.userCandidates(channelId, query).catch((cause) => {
        people.delete(key);
        console.error('Failed to search people to mention', cause);
        return [];
      });
      people.set(key, result);
    }
    return result;
  };

  /** Workspace people and Agents outside the Channel whose name matches `query`. */
  const options = async (query: string): Promise<ISlashMenuOption[]> => {
    const { agentOptions, channel, enabled, members } = latest.current;
    const search = query.trim();
    if (!enabled || !channel || !search) return [];
    const agents = matchInviteAgents(agentOptions.agents ?? [], {
      exclude: members.flatMap((member) => (member.agentId ? [member.agentId] : [])),
      nameOf: (agent) => agentDisplayName(agent, t('unnamedAgent')),
      priorityIds: agentOptions.projectAgentIds,
      query: search,
    });
    // People join only workspace Channels.
    // The search result may predate someone joining, so members are filtered here as well.
    const memberUserIds = new Set(members.map((member) => member.userId));
    const persons = channel.workspaceId
      ? (await searchPeople(channel.id, search))
          .filter((person) => !memberUserIds.has(person.userId))
          .slice(0, MENTION_INVITE_LIMIT)
      : [];
    return [
      ...persons.map((person) => {
        const name = person.fullName || person.username || t('person');
        return {
          icon: <Avatar avatar={person.avatar || DEFAULT_USER_AVATAR} size={24} title={name} />,
          key: `invite:${inviteKey({ actorType: 'user', id: person.userId })}`,
          label: name,
          metadata: {
            actorType: 'user',
            id: person.userId,
            name,
            type: 'channel-invite',
          } satisfies ChannelMentionInvite,
        };
      }),
      ...agents.map((agent) => {
        const name = agentDisplayName(agent, t('unnamedAgent'));
        return {
          icon: (
            <AgentAvatar
              agentId={agent.id}
              avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
              background={agent.backgroundColor ?? undefined}
              name={name}
              shape={'circle'}
              size={24}
            />
          ),
          key: `invite:${inviteKey({ actorType: 'agent', id: agent.id })}`,
          label: name,
          metadata: {
            actorType: 'agent',
            id: agent.id,
            name,
            type: 'channel-invite',
          } satisfies ChannelMentionInvite,
        };
      }),
    ];
  };

  /**
   * The member `target` already is, or adds them once however often they are mentioned.
   * Undefined where no one can be invited, such as a chip pasted into a direct conversation:
   * like any other chip for a non-member, it then stays plain text.
   */
  const invite = (target: ChannelMentionInvite): Promise<string | undefined> => {
    const { channel, enabled, members } = latest.current;
    const joined = members.find((member) =>
      target.actorType === 'user'
        ? member.actorType === 'user' && member.userId === target.id
        : member.agentId === target.id,
    );
    if (joined) return Promise.resolve(joined.id);
    if (!enabled || !channel) return Promise.resolve(undefined);
    const key = inviteKey(target);
    const pending = running.get(key);
    if (pending) return pending;
    setError('');
    const added = (
      target.actorType === 'user'
        ? channelActions.addMember(channel.id, { userId: target.id })
        : resolveAgent(target.id).then((agent) => channelActions.addMember(channel.id, { agent }))
    )
      .then((memberId) => {
        // Searches cached before the invite would still list them as outside.
        people.clear();
        return memberId;
      })
      .catch((cause: unknown) => {
        console.error('Failed to invite a mentioned member', cause);
        const reasonKey =
          cause instanceof AgentIssueError
            ? channelAgentIssueKey(cause.issue, true)
            : getChannelSaveErrorKey(cause);
        setError(
          reasonKey === 'environment.saveFailed'
            ? t('mentionInvite.failed', { name: target.name })
            : t('mentionInvite.failedReason', { name: target.name, reason: t(reasonKey) }),
        );
        throw cause;
      })
      .finally(() => running.delete(key));
    running.set(key, added);
    return added;
  };

  /**
   * Member ids for the outsiders a message mentions, waiting for invites still in flight and
   * retrying failed ones. Undefined when someone could not join; the error says who.
   */
  const resolve = async (targets: ChannelMentionInvite[]) => {
    const results = await Promise.allSettled(targets.map(invite));
    const ids: string[] = [];
    for (const result of results) {
      if (result.status === 'rejected') return;
      if (result.value) ids.push(result.value);
    }
    return ids;
  };

  return {
    /** Mounts the hidden environment resolution of Agents being invited. */
    agentDrafts: drafts.length > 0 && (
      <AgentDrafts drafts={drafts} setDrafts={setDrafts} onSettle={settleAgent} />
    ),
    clearError: () => setError(''),
    enabled,
    error,
    invite: (target: ChannelMentionInvite) => void invite(target).catch(() => {}),
    options,
    resolve,
  };
};
