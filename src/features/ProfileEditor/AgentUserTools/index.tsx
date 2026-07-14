'use client';

import { upsertPluginMode } from '@lobechat/types';
import { Flexbox, Icon, Tooltip } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { InfoIcon } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentToolProps } from '@/features/ProfileEditor/AgentTool';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import AgentToolsSection from './AgentToolsSection';
import UserToolsSection from './UserToolsSection';

/**
 * The profile "Model & Tools" tools area — a single page with two stacked
 * sections: Agent Tools (top, connectors bound to this agent) and User Tools
 * (bottom, the user's pinned tools). Agent tools resolve with priority over
 * same-named user tools at runtime.
 */
const AgentUserTools = memo<AgentToolProps>((props) => {
  const { agentId } = props;
  const { t } = useTranslation('setting');
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

  return (
    <Flexbox gap={16} width={'100%'}>
      <Flexbox horizontal align={'center'} justify={'flex-end'}>
        <Tooltip title={t('settingAgent.agentTools.priorityTooltip')}>
          <Flexbox
            horizontal
            align={'center'}
            gap={4}
            style={{ cursor: 'help', fontSize: 12, opacity: 0.55 }}
          >
            <Icon icon={InfoIcon} size={14} />
            {t('settingAgent.agentTools.priorityHint')}
          </Flexbox>
        </Tooltip>
      </Flexbox>

      <AgentToolsSection agentId={effectiveAgentId} onStartCopy={() => setCopyMode(true)} />

      <UserToolsSection
        {...props}
        agentId={effectiveAgentId}
        copyMode={copyMode}
        copying={copying}
        selected={selected}
        toggleSelected={toggleSelected}
        onCancelCopy={resetCopy}
        onConfirmCopy={handleConfirmCopy}
      />
    </Flexbox>
  );
});

AgentUserTools.displayName = 'AgentUserTools';

export default AgentUserTools;
