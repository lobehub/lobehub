import type { ChatTopic } from '@lobechat/types';
import { ActionIcon, type DropdownItem, DropdownMenu, Icon, toast } from '@lobehub/ui';
import {
  ArrowUpRightIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SettingsIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { resolveTargetDeviceId } from '@/helpers/agentWorkingDirectory';
import { useEffectiveAgencyConfig } from '@/hooks/useEffectiveAgencyConfig';
import { useElectronStore } from '@/store/electron';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { openBindDirectoryModal } from './BindDirectoryModal';

export function AgentDirectoryActions({
  agentId,
  path,
  topics,
  onLegacyStart,
  hideStartAction = false,
  pathOnly = false,
  extraMenuItems,
}: {
  agentId: string;
  path: string;
  topics: ChatTopic[];
  onLegacyStart: (projectWorkingDirectoryId?: string) => Promise<void>;
  /** Render only the binding/menu affordance; the caller provides its own start action. */
  hideStartAction?: boolean;
  /**
   * A plain path group: never resolve a project directory by path. A project
   * that registered the same path must not adopt new topics started here; the
   * menu offers binding instead so the user files the group explicitly.
   */
  pathOnly?: boolean;
  /** Group-level actions appended to the "more" menu after a divider. */
  extraMenuItems?: DropdownItem[];
}) {
  const { t } = useTranslation('project');
  const navigate = useWorkspaceAwareNavigate();
  const { agencyConfig, workspaceScoped } = useEffectiveAgencyConfig(agentId, {
    topicId: null,
  });
  const currentDeviceId = useElectronStore((s) => s.gatewayDeviceInfo?.deviceId);
  const pinnedDevice = topics[0]?.metadata?.boundDeviceId;
  const deviceId =
    pinnedDevice ?? resolveTargetDeviceId(agencyConfig, currentDeviceId, { workspaceScoped });
  // Keep the directories query warm for the binding menu below.
  useProjectDirectoryStore((s) => s.useFetchDirectories)();
  const directories = useProjectDirectories();
  const bindingId = topics[0]?.projectWorkingDirectoryId;
  const bindings = pathOnly
    ? []
    : directories.filter((directory) =>
        bindingId
          ? directory.id === bindingId
          : directory.deviceId === deviceId &&
            directory.path.replace(/[\\/]+$/, '') === path.replace(/[\\/]+$/, ''),
      );
  const [pending, setPending] = useState(false);
  // "+" opens the new-topic composer for this group; it must never create a
  // topic. The row is persisted on the first message, which is also when the
  // directory is applied — the caller stages it so the deferred topic is still
  // born inside the project instead of dropping into a path-only conversation.
  const start = async (projectWorkingDirectoryId?: string) => {
    setPending(true);
    try {
      await onLegacyStart(projectWorkingDirectoryId);
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
            icon: <Icon icon={ArrowUpRightIcon} />,
            key: `open-${directory.id}`,
            label: t('topics.viewProject'),
            onClick: () => navigate(`/project/${directory.projectSlug ?? directory.projectId}`),
          })),
          ...(bindings.length ? [{ type: 'divider' as const }] : []),
          ...bindings.map((directory) => ({
            icon: <Icon icon={SettingsIcon} />,
            key: `settings-${directory.id}`,
            label: t('topics.settings'),
            onClick: () =>
              navigate(`/project/${directory.projectSlug ?? directory.projectId}/settings`),
          })),
          ...(bindings.length
            ? []
            : [
                {
                  icon: <Icon icon={LinkIcon} />,
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
          ...(extraMenuItems?.length ? [{ type: 'divider' as const }, ...extraMenuItems] : []),
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
      {!hideStartAction && (
        <ActionIcon
          disabled={pending}
          icon={PlusIcon}
          size="small"
          title={t('directories.start')}
          onClick={(e) => {
            e.stopPropagation();
            void start(bindings[0]?.id);
          }}
        />
      )}
    </>
  );
}
