import type { ChannelPublicMember } from '@lobechat/types';
import { Button, createModal, Flexbox, Text, toast, useModalContext } from '@lobehub/ui';
import { t } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import AsyncError from '@/components/AsyncError';
import { channelActions } from '@/store/channel';
import { useDeviceList } from '@/store/device/useDeviceList';

import type { ChannelAgentDraft } from './CreateChannel/agentEnvironment';
import { EnvironmentFields, EnvironmentIssue } from './CreateChannel/EnvironmentFields';
import { useChannelAgentDraft } from './CreateChannel/useChannelAgentDraft';
import { MemberAvatar } from './MemberAvatar';
import { memberName } from './memberName';

interface Environment {
  agentId: string;
  deviceId?: string;
  workingDirectory?: string;
}

function EnvironmentForm({
  channelId,
  current,
  member,
}: {
  channelId: string;
  current: Environment;
  member: ChannelPublicMember;
}) {
  const { t } = useTranslation(['channel', 'common']);
  const { close } = useModalContext();
  // The saved channel choice is the starting point, not the Agent's own defaults.
  const [drafts, setDrafts] = useState<ChannelAgentDraft[]>(() => [
    { ...current, initialized: true },
  ]);
  const devices = useDeviceList({ refreshInterval: 15_000 });
  const controls = useChannelAgentDraft(drafts[0], devices, setDrafts);
  const { draft } = controls;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const name = memberName(member, t('unnamedAgent'));
  const changed =
    (draft.deviceId ?? '') !== (current.deviceId ?? '') ||
    (draft.workingDirectory ?? '') !== (current.workingDirectory ?? '');

  const save = async () => {
    if (busy || !changed || draft.issue) return;
    setBusy(true);
    setError(undefined);
    try {
      await channelActions.updateAgentEnvironment(channelId, member.id, {
        deviceId: draft.deviceId,
        workingDirectory: draft.workingDirectory,
      });
      toast.success(t('environment.saved'));
      close();
    } catch (cause) {
      console.error('Failed to update Channel member environment', cause);
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flexbox gap={16}>
      <Flexbox horizontal align="center" gap={8}>
        <MemberAvatar member={member} size={28} />
        <Text ellipsis weight={500}>
          {name}
        </Text>
      </Flexbox>
      <Flexbox gap={8} inert={busy}>
        <EnvironmentFields controls={controls} devices={devices} name={name} />
        <EnvironmentIssue controls={controls} />
      </Flexbox>
      <Text fontSize={12} type="secondary">
        {t('environment.scopeHint')}
      </Text>
      {error !== undefined && (
        <AsyncError error={error} title={t('environment.updateFailed')} variant="inline" />
      )}
      <Flexbox horizontal gap={8} justify="flex-end">
        <Button disabled={busy} onClick={close}>
          {t('cancel', { ns: 'common' })}
        </Button>
        <Button
          disabled={!changed || !!draft.issue}
          loading={busy}
          type="primary"
          onClick={() => void save()}
        >
          {t('save', { ns: 'common' })}
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

function AgentEnvironment({
  channelId,
  member,
}: {
  channelId: string;
  member: ChannelPublicMember;
}) {
  const { data, error, isLoading, mutate } = channelActions.useFetchAgentEnvironment(
    channelId,
    member.id,
  );
  return (
    <AsyncBoundary data={data} error={error} isLoading={isLoading} onRetry={() => void mutate()}>
      {data && <EnvironmentForm channelId={channelId} current={data} member={member} />}
    </AsyncBoundary>
  );
}

/** Where one Agent runs in this Channel; its own Agent settings stay unchanged. */
export const openChannelAgentEnvironment = (channelId: string, member: ChannelPublicMember) =>
  createModal({
    content: <AgentEnvironment channelId={channelId} member={member} />,
    footer: null,
    title: t('environment.title', { ns: 'channel' }),
    width: 'min(90vw, 480px)',
  });
