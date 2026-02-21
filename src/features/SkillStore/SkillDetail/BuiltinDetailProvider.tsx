'use client';

import isEqual from 'fast-deep-equal';
import { type ReactNode } from 'react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

import { type DetailContextValue } from './DetailContext';
import { DetailContext } from './DetailContext';

interface BuiltinDetailProviderProps {
  children: ReactNode;
  identifier: string;
}

export const BuiltinDetailProvider = ({ children, identifier }: BuiltinDetailProviderProps) => {
  const { t } = useTranslation(['setting']);

  // Use allMetaList to show details for all builtin tools (including not installed ones)
  const builtinTools = useToolStore(builtinToolSelectors.allMetaList, isEqual);

  const toolMeta = useMemo(
    () => builtinTools.find((tool) => tool.identifier === identifier),
    [identifier, builtinTools],
  );

  // Get the full builtin tool data to access API definitions
  const builtinToolsData = useToolStore((s) => s.builtinTools, isEqual);
  const toolData = useMemo(
    () => builtinToolsData.find((tool) => tool.identifier === identifier),
    [identifier, builtinToolsData],
  );

  if (!toolMeta || !toolData) return null;

  const { meta } = toolMeta;
  const { manifest } = toolData;

  // Convert API definitions to tools format
  const tools = (manifest.api || []).map((api) => ({
    description: api.description,
    inputSchema: api.parameters,
    name: api.name,
  }));

  const localizedTitle = t(`tools.builtins.${identifier}.title`, {
    defaultValue: meta?.title || identifier,
  });
  const localizedDescription = t(`tools.builtins.${identifier}.description`, {
    defaultValue: meta?.description || '',
  });
  const localizedReadme = t(`tools.builtins.${identifier}.readme`, {
    defaultValue: manifest.meta.readme || '',
  });

  const value: DetailContextValue = {
    author: 'LobeHub',
    authorUrl: 'https://lobehub.com',
    config: null as any, // Builtin tools don't have provider config
    description: meta?.description || '',
    icon: meta?.avatar || '',
    identifier,
    isConnected: true, // Builtin tools are always "connected"
    label: localizedTitle,
    localizedDescription,
    localizedReadme,
    readme: manifest.meta.readme || '',
    tools,
    toolsLoading: false,
  };

  return <DetailContext value={value}>{children}</DetailContext>;
};
