import { agentDisplayName, CHANNEL_LIMITS } from '@lobechat/types';
import { Button, createModal, Flexbox, Icon, Input, Text, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { Hash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import type { ChannelPersonOption } from '@/services/channel';
import { channelActions } from '@/store/channel';

import type { ChannelAgentDraft } from './agentEnvironment';
import { canSubmitChannelAgents, toChannelAgentSelection } from './agentEnvironment';
import { defaultChannelTitle } from './channelTitle';
import { MemberSelection } from './MemberSelection';
import { getChannelSaveErrorKey } from './saveError';
import { useChannelAgentOptions } from './useChannelAgentOptions';

interface ExistingChannel {
  /** Agents already in the Channel. */
  agentIds: string[];
  id: string;
  /** People can be invited only into workspace Channels. */
  workspaceId: string | null;
}

interface CreateChannelProps {
  /** Set when inviting members into a Channel that already exists. */
  existing?: ExistingChannel;
  onCreated?: (id: string) => void;
}

const openMemberDialog = (props: CreateChannelProps) =>
  createModal({
    content: <CreateChannel {...props} />,
    footer: null,
    title: t(props.existing ? 'invite.title' : 'create', { ns: 'channel' }),
    width: 'min(90vw, 800px)',
  });

export const openCreateChannel = (onCreated?: (id: string) => void) =>
  openMemberDialog({ onCreated });

/** The single entry for adding people and Agents to an existing Channel. */
export const openInviteMembers = (existing: ExistingChannel) => openMemberDialog({ existing });

/**
 * Like starting a group chat: choose members first. The name is optional and defaults to the
 * members' names; the sidebar renames it later. Inviting into an existing Channel uses the
 * same picker without a name, and also lists workspace members in workspace Channels.
 */
function CreateChannel({ existing, onCreated }: CreateChannelProps) {
  const { t } = useTranslation('channel');
  const { close, setCanDismissByClickOutside } = useModalContext();
  const [title, setTitle] = useState('');
  const [agents, setAgents] = useState<ChannelAgentDraft[]>([]);
  const [people, setPeople] = useState<ChannelPersonOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const options = useChannelAgentOptions();
  const dirty = !!title.trim() || agents.length > 0 || people.length > 0;

  // A mask click must not drop what the user typed or picked; ✕ and Esc still close.
  useEffect(() => {
    setCanDismissByClickOutside(!dirty && !busy);
  }, [busy, dirty, setCanDismissByClickOutside]);

  const autoTitle = defaultChannelTitle(
    agents.map(({ agentId }) =>
      agentDisplayName(
        options.agents?.find((agent) => agent.id === agentId),
        t('unnamedAgent'),
      ),
    ),
    {
      more: (names, count, total) => t('autoTitle.more', { count, names, total }),
      separator: t('autoTitle.separator'),
    },
    CHANNEL_LIMITS.titleLength,
  );
  const canSubmit = canSubmitChannelAgents(agents) || (!agents.length && people.length > 0);

  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const selections = agents.map(toChannelAgentSelection);
      if (existing) {
        await channelActions.addMembers(existing.id, {
          agents: selections,
          userIds: people.map((person) => person.userId),
        });
        close();
      } else {
        const id = await channelActions.create({
          agents: selections,
          title: title.trim() || autoTitle,
        });
        close();
        onCreated?.(id);
      }
    } catch (cause) {
      console.error('Failed to save Channel members', cause);
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8} inert={busy}>
        {!existing && <Text weight={500}>{t('agents')}</Text>}
        <MemberSelection
          exclude={existing?.agentIds}
          options={options}
          value={agents}
          people={
            existing?.workspaceId
              ? { channelId: existing.id, onChange: setPeople, value: people }
              : undefined
          }
          onChange={setAgents}
        />
      </Flexbox>
      {!existing && (
        <Flexbox gap={6} inert={busy}>
          <label htmlFor="channel-title" style={{ fontWeight: 500 }}>
            {t('nameOptional')}
          </label>
          <Input
            id="channel-title"
            maxLength={CHANNEL_LIMITS.titleLength}
            placeholder={autoTitle || t('nameAutoPlaceholder')}
            prefix={<Icon icon={Hash} size={14} />}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onPressEnter={() => void submit()}
          />
        </Flexbox>
      )}
      {error !== undefined && (
        <AsyncError error={error} title={t(getChannelSaveErrorKey(error))} variant="inline" />
      )}
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        {agents.length > 0 && !canSubmit && (
          <Text fontSize={12} type="secondary">
            {t('environment.completeRequired')}
          </Text>
        )}
        <Button disabled={busy} onClick={close}>
          {t('cancel')}
        </Button>
        <Button disabled={!canSubmit} loading={busy} type="primary" onClick={() => void submit()}>
          {t(existing ? 'invite.submit' : 'submit')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}
