'use client';

import { Accordion, AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { LayoutGrid, List } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import Action from '@/features/ChatInput/ActionBar/components/Action';
import {
  GenerationTopicStoreProvider,
  SkeletonList,
  TopicList,
  TopicUrlSync,
} from '@/routes/(main)/(create)/features/GenerationTopicList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../types';

enum GroupKey {
  Topics = 'topics',
}

const Body = memo<GenerationLayoutCommonProps>((props) => {
  const { namespace, useStore, viewModeStatusKey, generationTopicsSelector } = props;
  const { t } = useTranslation(namespace);
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));
  const updateSystemStatus = useGlobalStore((s) => s.updateSystemStatus);

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);

  const generationTopics = useStore(generationTopicsSelector);
  const count = generationTopics?.length || 0;

  return (
    <GenerationTopicStoreProvider value={{ namespace, useStore: useStore as any }}>
      <Flexbox gap={1} paddingInline={4}>
        <Accordion defaultExpandedKeys={[GroupKey.Topics]} gap={2}>
          <AccordionItem
            itemKey={GroupKey.Topics}
            paddingBlock={4}
            paddingInline={'8px 4px'}
            action={
              <Flexbox horizontal gap={2}>
                <Action
                  icon={List}
                  title={'List'}
                  onClick={() => updateSystemStatus({ [viewModeStatusKey]: 'list' })}
                />
                <Action
                  icon={LayoutGrid}
                  title={'Grid'}
                  onClick={() => updateSystemStatus({ [viewModeStatusKey]: 'grid' })}
                />
              </Flexbox>
            }
            title={
              <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
                {t('topic.title')}
                {count > 0 && ` ${count}`}
              </Text>
            }
          >
            <Suspense fallback={<SkeletonList />}>
              <Flexbox gap={1} paddingBlock={1}>
                <TopicList viewMode={viewMode} />
                <TopicUrlSync />
              </Flexbox>
            </Suspense>
          </AccordionItem>
        </Accordion>
      </Flexbox>
    </GenerationTopicStoreProvider>
  );
});

Body.displayName = 'GenerationLayoutBody';

export default Body;
