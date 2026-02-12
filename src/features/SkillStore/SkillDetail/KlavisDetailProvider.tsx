'use client';

import { getKlavisServerByServerIdentifier } from '@lobechat/const';
import { type Klavis } from 'klavis';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';

import { type DetailContextValue } from './DetailContext';
import { DetailContext } from './DetailContext';

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

  if (!config) return null;

  const { author, authorUrl, description, icon, readme, label } = config;

  const localizedDescription = t(`tools.klavis.servers.${identifier}.description`, {
    defaultValue: description,
  });
  const localizedReadme = t(`tools.klavis.servers.${identifier}.readme`, {
    defaultValue: readme,
  });

  const value: DetailContextValue = {
    author,
    authorUrl,
    config,
    description,
    icon,
    identifier,
    isConnected,
    label,
    localizedDescription,
    localizedReadme,
    readme,
    serverName,
    tools,
    toolsLoading,
  };

  return <DetailContext value={value}>{children}</DetailContext>;
};
