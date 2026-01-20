'use client';

import { Flexbox } from '@lobehub/ui';
import { type AnchorProps } from 'antd';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToc } from '@/app/[variants]/(main)/community/(detail)/features/Toc/useToc';
import { useQuery } from '@/hooks/useQuery';
import { AssistantNavKey } from '@/types/discover';

import Title from '../../../../../features/Title';
import Toc from '../../../../features/Toc';

const TocList = memo(() => {
  const { t } = useTranslation('discover');
  const { toc = [] } = useToc();
  const { activeTab = AssistantNavKey.Overview } = useQuery() as { activeTab: AssistantNavKey };

  const items: AnchorProps['items'] | undefined = useMemo(() => {
    switch (activeTab) {
      case AssistantNavKey.SystemRole: {
        return toc;
      }
      default: {
        return undefined;
      }
    }
  }, [activeTab, toc]);

  if (!items || items.length === 0) return null;

  return (
    <Flexbox gap={16}>
      <Title>{t('assistants.details.sidebar.toc')}</Title>
      <Toc items={items} />
    </Flexbox>
  );
});

export default TocList;
