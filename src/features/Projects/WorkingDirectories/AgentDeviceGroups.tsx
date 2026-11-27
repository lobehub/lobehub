import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import type { LobeAgentAgencyConfig } from '@lobechat/types';
import { agentDisplayName, resolveAgencyConfig } from '@lobechat/types';
import { Button, cssVar, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { PlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AgentAvatar from '@/components/AgentAvatar';
import { getDeviceIcon } from '@/features/DeviceManager/getDeviceIcon';
import { getAgentOwnDevice } from '@/helpers/agentOwnDevice';
import { deviceSelectors, useDeviceStore } from '@/store/device';
import { type ProjectDetail, useCurrentProjectDetail } from '@/store/project';
import type { ProjectDirectory } from '@/store/projectWorkingDirectory';
import { useUserStore } from '@/store/user';

import { openAddDirectoryModal } from './AddDirectoryModal';
import { DevicePresence } from './DevicePresence';
import { isRunnableProjectDirectory } from './startProjectTopicDraft';

/**
 * The project's members that run on a device of their own: heterogeneous
 * agents (Claude Code, Codex, Cursor, …) whose device is set
 * (`getAgentOwnDevice`), as this member's device pick makes it. The main
 * agent and enabled members only, as the composer offers them.
 */
export const listAgentsWithOwnDevice = (
  detail: Pick<ProjectDetail, 'agents' | 'project'>,
  overrides: Record<string, Parameters<typeof resolveAgencyConfig>[1]> | undefined,
) =>
  (detail.agents ?? []).flatMap(({ agent, binding }) => {
    if (!binding.enabled && agent.id !== detail.project.coordinatorAgentId) return [];
    const ownDevice = getAgentOwnDevice(
      resolveAgencyConfig(
        agent.agencyConfig as LobeAgentAgencyConfig | null | undefined,
        overrides?.[agent.id],
      ),
    );
    return ownDevice ? [{ agent, ownDevice }] : [];
  });

interface AgentDeviceGroupsProps {
  canManage: boolean;
  directories: readonly ProjectDirectory[];
  environmentId?: string;
  projectId: string;
}

/**
 * The members' own devices, apart from the project's order: each agent that
 * runs on a device of its own, the device and whether it is online, and the
 * project folder there it starts in — or a way to add one. These agents run
 * on their own device first, whatever the order above says.
 */
export function AgentDeviceGroups({
  canManage,
  directories,
  environmentId,
  projectId,
}: AgentDeviceGroupsProps) {
  const { t } = useTranslation('project');
  const { t: tCommon } = useTranslation('common');
  const devices = useDeviceStore(deviceSelectors.deviceList);
  const overrides = useUserStore((s) => s.workspaceUserPreference.agentDeviceOverrides);
  const detail = useCurrentProjectDetail(projectId);
  const agents = detail ? listAgentsWithOwnDevice(detail, overrides) : [];
  if (agents.length === 0) return null;

  return (
    <Flexbox gap={12}>
      <Flexbox gap={4}>
        <Text fontSize={15} weight={500}>
          {t('settings.agentDevices')}
        </Text>
        <Text fontSize={13} type="secondary">
          {t('settings.agentDevicesHint')}
        </Text>
      </Flexbox>
      {agents.map(({ agent, ownDevice }) => {
        const device = devices.find((item) => item.deviceId === ownDevice.deviceId);
        const folders = directories.filter(
          (directory) =>
            directory.deviceId === ownDevice.deviceId && isRunnableProjectDirectory(directory),
        );
        const name = agentDisplayName(agent, tCommon('defaultAgent'));
        const deviceName =
          device?.friendlyName || device?.hostname || folders[0]?.deviceName || ownDevice.deviceId;
        const presence = device?.onlineUnknown
          ? undefined
          : t(device?.online ? 'settings.deviceOnline' : 'settings.deviceOffline');
        const provider = getHeterogeneousTypeLabel(
          (agent.agencyConfig as LobeAgentAgencyConfig | null)?.heterogeneousProvider?.type,
        );
        return (
          <Flexbox
            horizontal
            align="center"
            gap={12}
            key={agent.id}
            padding={16}
            style={{ background: cssVar.colorFillQuaternary, borderRadius: 16 }}
          >
            <AgentAvatar
              agentId={agent.id}
              avatar={typeof agent.avatar === 'string' ? agent.avatar : undefined}
              background={agent.backgroundColor || undefined}
              name={name}
              shape="square"
              size={40}
            />
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
                <Text ellipsis fontSize={15} weight={500}>
                  {name}
                </Text>
                {provider && <Tag size="small">{provider}</Tag>}
                {!ownDevice.sandboxFallback && (
                  <Tag size="small">{t('settings.agentDeviceOnly')}</Tag>
                )}
              </Flexbox>
              <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', flex: 'none' }}>
                  {getDeviceIcon(device?.platform ?? folders[0]?.platform ?? undefined, 14)}
                </span>
                <Text
                  ellipsis
                  fontSize={12}
                  style={{ flex: 'none', maxWidth: 200 }}
                  type="secondary"
                >
                  {deviceName}
                </Text>
                <DevicePresence device={device} />
                {presence && (
                  <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
                    {presence}
                  </Text>
                )}
                <Text fontSize={12} style={{ flex: 'none' }} type="secondary">
                  ·
                </Text>
                {folders.length > 0 ? (
                  <Text ellipsis={{ tooltipWhenOverflow: true }} fontSize={12} type="secondary">
                    {folders.map((folder) => folder.path).join(', ')}
                  </Text>
                ) : (
                  <Text fontSize={12} style={{ color: cssVar.colorWarningText }}>
                    {t('settings.agentDeviceNoDirectory')}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
            {folders.length === 0 && canManage && (
              <Button
                icon={<Icon icon={PlusIcon} />}
                size="small"
                style={{ flex: 'none' }}
                onClick={() =>
                  openAddDirectoryModal(projectId, environmentId, {
                    deviceId: ownDevice.deviceId,
                  })
                }
              >
                {t('settings.agentDeviceAddDirectory')}
              </Button>
            )}
          </Flexbox>
        );
      })}
    </Flexbox>
  );
}
