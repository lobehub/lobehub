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
  // const { deploymentOptions = [], tools = [], prompts = [] } = useDetailContext();
  //
  // const schemaToc: AnchorProps['items'] = useMemo(() => {
  //   return [
  //     {
  //       href: `#tools`,
  //       key: `tools`,
  //       level: 2,
  //       title: t('mcp.details.schema.tools.title'),
  //     },
  //     ...tools.map((item) => ({
  //       href: `#tools-${item.name}`,
  //       key: `tools-${item.name}`,
  //       level: 3,
  //       title: item.name,
  //     })),
  //     {
  //       href: `#prompts`,
  //       key: `prompts`,
  //       level: 2,
  //       title: t('mcp.details.schema.prompts.title'),
  //     },
  //     ...prompts.map((item) => ({
  //       href: `#prompts-${item.name}`,
  //       key: `prompts-${item.name}`,
  //       level: 3,
  //       title: item.name,
  //     })),
  //     {
  //       href: `#resources`,
  //       key: `resources`,
  //       level: 2,
  //       title: t('mcp.details.schema.resources.title'),
  //     },
  //   ].filter(Boolean) as AnchorProps['items'];
  // }, [tools, prompts, t]);

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
