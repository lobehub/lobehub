'use client';

import { getLobehubSkillProviderById } from '@lobechat/const';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { discoverService } from '@/services/discover';
import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { DetailContext, type DetailContextValue } from './DetailContext';

interface LobehubDetailProviderProps {
  children: ReactNode;
  identifier: string;
}

export const LobehubDetailProvider = ({ children, identifier }: LobehubDetailProviderProps) => {
  const { t } = useTranslation(['setting']);

  const config = useMemo(() => getLobehubSkillProviderById(identifier), [identifier]);

  const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers);

  const serverState = useMemo(
    () => lobehubSkillServers.find((s) => s.identifier === identifier),
    [identifier, lobehubSkillServers],
  );

  const isConnected = useMemo(
    () => serverState?.status === LobehubSkillStatus.CONNECTED,
    [serverState],
  );

  const useFetchProviderTools = useToolStore((s) => s.useFetchProviderTools);
  const { data: tools = [], isLoading: toolsLoading } = useFetchProviderTools(identifier);

  // Fetch agents that use this skill
  const { data: agentsData, isLoading: agentsLoading } = useClientDataSWR(
    identifier ? ['skill-agents', identifier] : null,
    () => discoverService.getAgentsByPlugin({ pageSize: 6, pluginId: identifier }),
  );

  if (!config) return null;

  const { author, authorUrl, description, icon, introduction, label } = config;

  const localizedDescription = t(`tools.lobehubSkill.providers.${identifier}.description`, {
    defaultValue: description,
  });
  const localizedIntroduction = t(`tools.lobehubSkill.providers.${identifier}.introduction`, {
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
    tools,
    toolsLoading,
  };

  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
};
