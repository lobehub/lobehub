import { useTranslation } from 'react-i18next';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { parseMcpEntryTab, selectMcpAppEntrypoints } from '@/features/MCPApp/entrypoints';
import { useToolStore } from '@/store/tool';

export const McpEntryTabLabel = ({ tab, agentId }: { tab: string; agentId?: string }) => {
  const parsed = parseMcpEntryTab(tab);
  const { t } = useTranslation('plugin');
  const title = useToolStore(
    (s) =>
      selectMcpAppEntrypoints(s, true, agentId).find(
        (entry) => entry.identifier === parsed?.identifier && entry.toolName === parsed?.toolName,
      )?.title,
  );
  return <>{title ?? parsed?.toolName ?? t('mcpApp.entrypoints')}</>;
};

export const McpEntryTabIcon = ({ tab, agentId }: { tab: string; agentId?: string }) => {
  const parsed = parseMcpEntryTab(tab);
  const icon = useToolStore(
    (s) =>
      selectMcpAppEntrypoints(s, true, agentId).find(
        (entry) => entry.identifier === parsed?.identifier && entry.toolName === parsed?.toolName,
      )?.icon,
  );
  return <PluginAvatar avatar={icon || 'MCP_AVATAR'} size={14} />;
};
