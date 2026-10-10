'use client';

import { COMPOSIO_APP_TYPES } from '@lobechat/const';
import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { gridStyles } from '@/features/SkillStore/SkillList/style';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import Item from './Item';

/**
 * "Connect new tool" store for a single agent — a trimmed, agent-scoped mirror
 * of SkillStore's first (LobeHub) tab. v1 lists Composio connectors; "connected"
 * reflects the AGENT's own connectors, and connecting binds a fresh account to
 * the agent (agent_id). LobeHub-OAuth / custom-MCP tabs are intentionally left
 * out for now.
 */
const AgentSkillStoreContent = memo<{ agentId: string }>(({ agentId }) => {
  const { t } = useTranslation('setting');
  const isComposioEnabled = useServerConfigStore(serverConfigSelectors.enableComposio);
  const isInit = useToolStore(connectorSelectors.isAgentConnectorsInit(agentId));
  const fetchAgentConnectors = useToolStore((s) => s.fetchAgentConnectors);

  useEffect(() => {
    if (agentId && !isInit) fetchAgentConnectors(agentId);
  }, [agentId, isInit, fetchAgentConnectors]);

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      {isComposioEnabled ? (
        <Flexbox height={496} style={{ marginBlockEnd: -12, marginInline: -16, overflow: 'auto' }}>
          <div className={gridStyles.grid}>
            {COMPOSIO_APP_TYPES.map((type) => (
              <Item
                agentId={agentId}
                appSlug={type.appSlug}
                description={type.description}
                icon={type.icon}
                identifier={type.identifier}
                key={type.identifier}
                label={type.label}
              />
            ))}
          </div>
        </Flexbox>
      ) : (
        <Text style={{ padding: 24 }} type={'secondary'}>
          {t('settingAgent.agentTools.pickerEmpty')}
        </Text>
      )}
    </Flexbox>
  );
});

AgentSkillStoreContent.displayName = 'AgentSkillStoreContent';

export default AgentSkillStoreContent;
