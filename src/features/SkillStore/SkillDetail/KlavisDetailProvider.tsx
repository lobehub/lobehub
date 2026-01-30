'use client';

import { getKlavisServerByServerIdentifier } from '@lobechat/const';
import type { Klavis } from 'klavis';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';

import { DetailContext, type DetailContextValue } from './DetailContext';

interface KlavisDetailProviderProps {
  children: ReactNode;
  identifier: string;
  serverName: Klavis.McpServerName;
}

export const KlavisDetailProvider = ({
  children,
  identifier,
  serverName,
}: KlavisDetailProviderProps) => {
  const { t } = useTranslation(['setting']);

  const config = useMemo(() => getKlavisServerByServerIdentifier(identifier), [identifier]);

  const klavisServers = useToolStore(klavisStoreSelectors.getServers);

  const serverState = useMemo(
    () => klavisServers.find((s) => s.identifier === identifier),
    [identifier, klavisServers],
  );

  const isConnected = useMemo(
    () => serverState?.status === KlavisServerStatus.CONNECTED,
    [serverState],
  );

  const useFetchServerTools = useToolStore((s) => s.useFetchServerTools);
  const { data: tools = [], isLoading: toolsLoading } = useFetchServerTools(serverName);

  // Fetch agents that use this skill
  const { data: agentsData, isLoading: agentsLoading } = useClientDataSWR(
    identifier ? ['skill-agents', identifier] : null,
    () => discoverService.getAgentsByPlugin({ pageSize: 6, pluginId: identifier }),
  );

  if (!config) return null;

  const { author, authorUrl, description, icon, introduction, label } = config;

  const localizedDescription = t(`tools.klavis.servers.${identifier}.description`, {
    defaultValue: description,
  });
  const localizedIntroduction = t(`tools.klavis.servers.${identifier}.introduction`, {
    defaultValue: introduction,
  });

  const value: DetailContextValue = {
    agents: agentsData?.items || [],
    agentsLoading,
    author,
    authorUrl,
    config,
    description,
    icon,
    identifier,
    introduction,
    isConnected,
    label,
    localizedDescription,
    localizedIntroduction,
    serverName,
    tools,
    toolsLoading,
  };

  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
};
