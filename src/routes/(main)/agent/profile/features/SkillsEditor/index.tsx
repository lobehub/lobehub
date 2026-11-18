'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import AgentUserTools from '@/features/ProfileEditor/AgentUserTools';
import { useItemDetailStore } from '@/features/ProfileEditor/itemDetailStore';

/**
 * The Skills page: the skills turned on for the agent, as one plain list. A row opens the
 * skill's details in the page's right-hand panel.
 */
const SkillsEditor = memo(() => {
  const { t } = useTranslation('setting');
  const open = useItemDetailStore((s) => s.open);

  // Leaving the page takes its panel with it.
  useEffect(() => useItemDetailStore.getState().close, []);

  return (
    <Flexbox gap={24} paddingBlock={'8px 48px'}>
      <Flexbox gap={4}>
        <Text fontSize={24} weight={600}>
          {t('settingAgent.skillsPage.title')}
        </Text>
        <Text type={'secondary'}>{t('settingAgent.skillsPage.desc')}</Text>
      </Flexbox>

      <AgentUserTools
        filterAvailableInWeb
        useAllMetaList
        kind={'skills'}
        variant={'list'}
        onOpenDetail={open}
      />
    </Flexbox>
  );
});

SkillsEditor.displayName = 'SkillsEditor';

export default SkillsEditor;
