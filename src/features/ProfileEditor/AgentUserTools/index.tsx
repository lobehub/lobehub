'use client';

import { upsertPluginMode } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveWorkspaceId } from '@/business/client/hooks/useActiveWorkspaceId';
import { type AgentToolProps } from '@/features/ProfileEditor/AgentTool';
import { type ToolGroupMeta } from '@/features/ProfileEditor/ToolListGroup';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import AgentToolsSection from './AgentToolsSection';
import RunPriorityHint from './RunPriorityHint';
import UserToolsSection from './UserToolsSection';

/**
 * The profile "Model & Tools" tools area — a single page with two stacked
 * sections: Agent Tools (top, connectors bound to this agent) and User Tools
 * (bottom, the user's pinned tools). Agent tools resolve with priority over
 * same-named user tools at runtime.
 */
const AgentUserTools = memo<AgentToolProps & { variant?: 'chip' | 'list' }>((props) => {
  const { agentId, variant = 'chip', ...toolProps } = props;
  const { t } = useTranslation('setting');
  const navigate = useWorkspaceAwareNavigate();
  const activeWorkspaceId = useActiveWorkspaceId();
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const effectiveAgentId = agentId || activeAgentId || '';

  const isInit = useToolStore(connectorSelectors.isAgentConnectorsInit(effectiveAgentId));
  const fetchAgentConnectors = useToolStore((s) => s.fetchAgentConnectors);
  const copyConnectorToAgent = useToolStore((s) => s.copyConnectorToAgent);
  const userConnectors = useToolStore(connectorSelectors.connectorList, isEqual);
  const updateAgentConfigById = useAgentStore((s) => s.updateAgentConfigById);

  useEffect(() => {
    if (effectiveAgentId && !isInit) fetchAgentConnectors(effectiveAgentId);
  }, [effectiveAgentId, isInit, fetchAgentConnectors]);

  const [copyMode, setCopyMode] = useState(false);
  const [copying, setCopying] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const resetCopy = () => {
    setCopyMode(false);
    setSelected(new Set());
  };

  const handleConfirmCopy = async () => {
    setCopying(true);
    try {
      const identifiers: string[] = [];
      for (const id of selected) {
        const conn = userConnectors.find((c) => c.id === id);
        if (!conn) continue;
        await copyConnectorToAgent(id, effectiveAgentId);
        identifiers.push(conn.identifier);
      }
      // Pin the copied tools for the agent so the runtime resolves them.
      if (identifiers.length > 0) {
        const config = agentSelectors.getAgentConfigById(effectiveAgentId)(
          useAgentStore.getState(),
        );
        let plugins = config?.plugins;
        for (const identifier of identifiers)
          plugins = upsertPluginMode(plugins, identifier, 'pinned');
        await updateAgentConfigById(effectiveAgentId, { plugins });
      }
      resetCopy();
    } finally {
      setCopying(false);
    }
  };

  if (variant === 'list') {
    // Two levels, named for what they mean to the person: what belongs to this agent alone,
    // and what it borrows from the library every agent shares. Skills only ever come from the
    // library, so their page has the one list.
    const isSkills = toolProps.kind === 'skills';
    const agentGroup: ToolGroupMeta = {
      desc: t('settingAgent.tools.level.agentDesc'),
      extra: <RunPriorityHint agentId={effectiveAgentId} />,
      title: t('settingAgent.agentTools.tabAgent'),
    };
    const libraryGroup: ToolGroupMeta = {
      plain: isSkills,
      desc: isSkills
        ? t('settingAgent.skillsPage.group.desc')
        : t(
            activeWorkspaceId
              ? 'settingAgent.tools.level.workspaceDesc'
              : 'settingAgent.tools.level.libraryDesc',
          ),
      extra: (
        <Button size={'small'} type={'text'} onClick={() => navigate('/settings/skill')}>
          {t('settingAgent.tools.manageLibrary')}
        </Button>
      ),
      title: isSkills
        ? t('settingAgent.skillsPage.group.title')
        : t(
            activeWorkspaceId
              ? 'settingAgent.agentTools.tabWorkspace'
              : 'settingAgent.agentTools.tabUser',
          ),
    };

    return (
      <Flexbox gap={16} width={'100%'}>
        {!isSkills && (
          <AgentToolsSection
            agentId={effectiveAgentId}
            group={agentGroup}
            variant={'list'}
            onOpenDetail={toolProps.onOpenDetail}
            onStartCopy={() => setCopyMode(true)}
          />
        )}
        <UserToolsSection
          {...toolProps}
          agentId={effectiveAgentId}
          copyMode={copyMode}
          copying={copying}
          group={libraryGroup}
          selected={selected}
          toggleSelected={toggleSelected}
          variant={'list'}
          onCancelCopy={resetCopy}
          onConfirmCopy={handleConfirmCopy}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={16} width={'100%'}>
      <AgentToolsSection
        agentId={effectiveAgentId}
        variant={variant}
        onStartCopy={() => setCopyMode(true)}
      />

      <UserToolsSection
        {...toolProps}
        agentId={effectiveAgentId}
        copyMode={copyMode}
        copying={copying}
        selected={selected}
        toggleSelected={toggleSelected}
        variant={variant}
        onCancelCopy={resetCopy}
        onConfirmCopy={handleConfirmCopy}
      />
    </Flexbox>
  );
});

AgentUserTools.displayName = 'AgentUserTools';

export default AgentUserTools;
