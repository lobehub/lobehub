import { getActivePluginIds } from '@lobechat/types';
import { Switch } from 'antd';
import { LinkIcon } from 'lucide-react';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { connectorSelectors } from '@/store/tool/slices/connector';

import { useStore } from '../store';

const AgentConnectors = memo(() => {
  const { t } = useTranslation('setting');

  const [userEnabledPlugins, toggleAgentPlugin] = useStore((s) => [
    getActivePluginIds(s.config.plugins),
    s.toggleAgentPlugin,
  ]);

  const connectors = useToolStore(connectorSelectors.connectorList);
  const fetchConnectors = useToolStore((s) => s.fetchConnectors);
  const isInit = useToolStore((s) => s.isConnectorsInit);

  useEffect(() => {
    if (!isInit) fetchConnectors();
  }, [isInit, fetchConnectors]);

  if (connectors.length === 0) {
    return (
      <div
        style={{ color: 'var(--lobe-colors-neutral-500)', padding: '24px 0', textAlign: 'center' }}
      >
        {t('agentConnectors.empty', 'No connectors connected yet. Go to Connectors to add one.')}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {connectors.map((connector) => {
        const isEnabled = userEnabledPlugins.includes(connector.identifier);
        const enabledCount = connector.tools.filter((t) => t.permission !== 'disabled').length;

        return (
          <div
            key={connector.id}
            style={{
              alignItems: 'center',
              borderRadius: 8,
              display: 'flex',
              gap: 10,
              padding: '10px 12px',
            }}
          >
            <LinkIcon size={16} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{connector.name}</div>
              <div style={{ color: 'var(--lobe-colors-neutral-500)', fontSize: 12 }}>
                {t('agentConnectors.toolCount', '{{count}} tools', { count: enabledCount })}
              </div>
            </div>
            <Switch
              checked={isEnabled}
              size="small"
              onChange={() => toggleAgentPlugin(connector.identifier)}
            />
          </div>
        );
      })}
    </div>
  );
});

AgentConnectors.displayName = 'AgentConnectors';

export default AgentConnectors;
