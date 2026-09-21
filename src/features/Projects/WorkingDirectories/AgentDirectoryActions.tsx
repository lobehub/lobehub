import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { ChatTopic } from '@lobechat/types';
import { ActionIcon, DropdownMenu, toast } from '@lobehub/ui/base-ui';
import { MoreHorizontalIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openBindDirectoryModal } from './BindDirectoryModal';

export function AgentDirectoryActions({
  agentId,
  path,
  topics,
  onLegacyStart,
}: {
  agentId: string;
  path: string;
  topics: ChatTopic[];
  onLegacyStart: () => Promise<void>;
}) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    ignoreTopic: true,
  });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const pinnedDevice = topics[0]?.metadata?.boundDeviceId;
  const deviceId =
    pinnedDevice ?? resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  const request = useProjectDirectoryStore((s) => s.useFetchDirectories)();
  const bindingId = topics[0]?.projectWorkingDirectoryId;
  const bindings = (request.data?.data ?? []).filter((directory) =>
    bindingId
      ? directory.id === bindingId
      : directory.deviceId === deviceId &&
        directory.path.replace(/[\\/]+$/, '') === path.replace(/[\\/]+$/, ''),
  );
  const [pending, setPending] = useState(false);
  const startTopic = useProjectDirectoryStore((s) => s.startTopic);
  const start = async (id?: string) => {
    setPending(true);
    try {
      if (id) {
        const topic = await startTopic(id, agentId, t('directories.untitled'));
        navigate(AGENT_CHAT_TOPIC_URL(agentId, topic.id));
      } else await onLegacyStart();
    } catch (error) {
      console.error('Failed to start directory conversation', error);
      toast.error(error instanceof Error ? error.message : t('operationFailed', { ns: 'common' }));
    } finally {
      setPending(false);
    }
  };
  const repositoryUrl = topics
    .map((topic) => topic.metadata?.repos?.[0])
    .find((url) => url?.startsWith('https://github.com/'));
  return (
    <>
      <DropdownMenu
        items={[
          ...bindings.map((directory) => ({
            key: `open-${directory.id}`,
            label: t('topics.viewProject'),
            onClick: () => navigate(`/project/${directory.projectSlug ?? directory.projectId}`),
          })),
          ...(bindings.length ? [{ type: 'divider' as const }] : []),
          ...bindings.map((directory) => ({
            key: `settings-${directory.id}`,
            label: t('topics.settings'),
            onClick: () =>
              navigate(`/project/${directory.projectSlug ?? directory.projectId}/settings`),
          })),
          ...(bindings.length
            ? []
            : [
                {
                  key: 'bind',
                  label: t('directories.bind'),
                  disabled: !deviceId,
                  onClick: () =>
                    deviceId &&
                    openBindDirectoryModal({
                      agentId,
                      deviceId,
                      path,
                      repositoryUrl,
                      topicIds: topics.map((topic) => topic.id),
                    }),
                },
              ]),
        ]}
      >
        <ActionIcon
          disabled={pending}
          icon={MoreHorizontalIcon}
          size="small"
          title={t('directories.projectBinding')}
          onClick={(e) => e.stopPropagation()}
        />
      </DropdownMenu>
      <ActionIcon
        icon={PlusIcon}
        size="small"
        title={t('directories.start')}
        disabled={
          pending ||
          request.isLoading ||
          !!request.error ||
          bindings.length > 1 ||
          (!!bindingId && !bindings.length)
        }
        onClick={(e) => {
          e.stopPropagation();
          void start(bindings[0]?.id);
        }}
      />
    </>
  );
}
