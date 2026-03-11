'use client';

import { getLobehubSkillProviderById } from '@lobechat/const';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

import { type DetailContextValue } from './DetailContext';
import { DetailContext } from './DetailContext';

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

  if (!config) return null;

  const { author, authorUrl, description, icon, readme, label } = config;

  const localizedDescription = t(`tools.lobehubSkill.providers.${identifier}.description`, {
    defaultValue: description,
  });
  const localizedReadme = t(`tools.lobehubSkill.providers.${identifier}.readme`, {
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
    tools,
    toolsLoading,
  };

  return <DetailContext value={value}>{children}</DetailContext>;
};
