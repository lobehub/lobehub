'use client';

import isEqual from 'fast-deep-equal';
import { type ReactNode, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import { DetailContext, type DetailContextValue } from './DetailContext';

interface BuiltinAgentSkillDetailProviderProps {
  children: ReactNode;
  identifier: string;
}

export const BuiltinAgentSkillDetailProvider = ({
  children,
  identifier,
}: BuiltinAgentSkillDetailProviderProps) => {
  const { t } = useTranslation(['setting']);

  const builtinSkills = useToolStore((s) => s.builtinSkills, isEqual);

  const skill = useMemo(
    () => builtinSkills.find((s) => s.identifier === identifier),
    [identifier, builtinSkills],
  );

  if (!skill) return null;

  const localizedTitle = t(`tools.builtins.${identifier}.title`, {
    defaultValue: skill.name,
  });
  const localizedDescription = t(`tools.builtins.${identifier}.description`, {
    defaultValue: skill.description,
  });
  const localizedReadme = t(`tools.builtins.${identifier}.readme`, {
    defaultValue: '',
  });

  const value: DetailContextValue = {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    config: null as any,
    description: skill.description,
    icon: skill.avatar || '',
    identifier,
    isConnected: true,
    label: localizedTitle,
    localizedDescription,
    localizedReadme,
    readme: '',
    skillContent: skill.content,
    tools: [],
    toolsLoading: false,
  };

  return <DetailContext value={value}>{children}</DetailContext>;
};
