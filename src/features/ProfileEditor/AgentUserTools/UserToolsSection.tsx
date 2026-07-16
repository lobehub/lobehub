'use client';

import { getActivePluginIds } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import isEqual from 'fast-deep-equal';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import SharedAgentTool, { type AgentToolProps } from '@/features/ProfileEditor/AgentTool';
import PluginTag from '@/features/ProfileEditor/PluginTag';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

interface Props extends AgentToolProps {
  agentId: string;
  copying: boolean;
  copyMode: boolean;
  onCancelCopy: () => void;
  onConfirmCopy: () => void;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
}

/**
 * The "User Tools" section (bottom of the tools area). Normally the user's
 * pinned tools (SharedAgentTool). In copy mode, the user's connectors become
 * selectable chips so several can be copied into the agent at once.
 */
const UserToolsSection = memo<Props>(
  ({
    agentId,
    copyMode,
    copying,
    onCancelCopy,
    onConfirmCopy,
    selected,
    toggleSelected,
    ...toolProps
  }) => {
    const { t } = useTranslation('setting');
    const userConnectors = useToolStore(connectorSelectors.connectorList, isEqual);
    const config = useAgentStore(agentSelectors.getAgentConfigById(agentId), isEqual);
    // Agent-owned/linked connector identifiers are shown in the Agent Tools
    // section above (and excluded from this section's chips in `AgentTool`), so
    // exclude them from the count too — otherwise the header would count a tool
    // that renders in the section above, not here.
    const agentConnectors = useToolStore(connectorSelectors.agentConnectors(agentId), isEqual);
    const agentConnectorIdentifiers = useMemo(
      () => new Set(agentConnectors.map((c) => c.identifier)),
      [agentConnectors],
    );
    const userToolCount = getActivePluginIds(config?.plugins).filter(
      (id) => !agentConnectorIdentifiers.has(id),
    ).length;
    // In a workspace, this section's base tools are the WORKSPACE dimension
    // (`connector.list` is workspace-scoped), not the caller's personal tools —
    // label it so the user knows the tools are shared workspace-scoped, not
    // their private ones. Personal mode keeps the "User Tools" label.
    const activeWorkspaceId = useActiveWorkspaceId();
    const baseToolsLabel = activeWorkspaceId
      ? t('settingAgent.agentTools.tabWorkspace')
      : t('settingAgent.agentTools.tabUser');

    // Copyable = the user's own base connectors (not agent-owned, not mounted).
    const copyable = userConnectors.filter((c) => !c.agentId && !c.metadata?.mountedByAgentId);

    if (copyMode) {
      return (
        <Flexbox gap={8}>
          <Flexbox horizontal align={'center'} justify={'space-between'}>
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('settingAgent.agentTools.copyPick')}
            </Text>
            <Flexbox horizontal gap={8}>
              <Button disabled={copying} size={'small'} type={'text'} onClick={onCancelCopy}>
                {t('cancel', { ns: 'common' })}
              </Button>
              <Button
                disabled={selected.size === 0 || copying}
                loading={copying}
                size={'small'}
                type={'primary'}
                onClick={onConfirmCopy}
              >
                {t('settingAgent.agentTools.copyConfirm', { count: selected.size })}
              </Button>
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            {copyable.length === 0 && (
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {t('settingAgent.agentTools.pickerEmpty')}
              </Text>
            )}
            {copyable.map((c) => (
              <PluginTag
                selectable
                key={c.id}
                pluginId={c.identifier}
                selected={selected.has(c.id)}
                onSelect={() => toggleSelected(c.id)}
              />
            ))}
          </Flexbox>
        </Flexbox>
      );
    }

    return (
      <Flexbox gap={8}>
        <Text style={{ fontSize: 12, fontWeight: 500 }} type={'secondary'}>
          {baseToolsLabel} · {userToolCount}
        </Text>
        <SharedAgentTool {...toolProps} excludeAgentConnectors agentId={agentId} />
      </Flexbox>
    );
  },
);

UserToolsSection.displayName = 'UserToolsSection';

export default UserToolsSection;
