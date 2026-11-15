import { useTranslation } from 'react-i18next';

import { mcpAppSelectors, useMcpAppStore } from '@/store/mcpApp/store';

import { LazyPluginAvatar } from './LazyPluginAvatar';

export const McpAppTabLabel = ({ id }: { id: string }) => {
  const view = useMcpAppStore(mcpAppSelectors.view(id));
  const { t } = useTranslation('plugin');
  return <>{view?.title ?? t('mcpApp.entrypoints')}</>;
};

export const McpAppTabIcon = ({ id }: { id: string }) => {
  const icon = useMcpAppStore((s) => s.views[id]?.icon);
  return <LazyPluginAvatar avatar={icon ?? 'MCP_AVATAR'} size={14} />;
};
