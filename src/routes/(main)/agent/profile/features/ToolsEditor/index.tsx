'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import AgentUserTools from '@/features/ProfileEditor/AgentUserTools';
import { useItemDetailStore } from '@/features/ProfileEditor/itemDetailStore';

/**
 * The Tools page: the tools and connectors the agent can act with, as two lists — the ones that
 * belong to this agent alone, and the ones it borrows from the library every agent shares. A row
 * opens its details in the page's right-hand panel.
 */
const ToolsEditor = memo(() => {
  const { t } = useTranslation('setting');
  const open = useItemDetailStore((s) => s.open);

  // Leaving the page takes its panel with it.
  useEffect(() => useItemDetailStore.getState().close, []);

  return (
    <Flexbox gap={32} paddingBlock={'8px 48px'}>
      <Flexbox gap={4}>
        <Text fontSize={24} weight={600}>
          {t('settingAgent.toolsPage.title')}
        </Text>
        <Text type={'secondary'}>{t('settingAgent.toolsPage.desc')}</Text>
      </Flexbox>

      <AgentUserTools
        filterAvailableInWeb
        useAllMetaList
        kind={'tools'}
        variant={'list'}
        onOpenDetail={open}
      />
    </Flexbox>
  );
});

ToolsEditor.displayName = 'ToolsEditor';

export default ToolsEditor;
