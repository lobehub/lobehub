'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import SkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../../types';
import { GenerationTopicStoreProvider } from './StoreContext';
import TopicList from './TopicList';
import TopicUrlSync from './TopicUrlSync';

const List = memo<
  Pick<GenerationLayoutCommonProps, 'namespace' | 'useStore' | 'viewModeStatusKey'>
>(({ namespace, useStore, viewModeStatusKey }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  useFetchGenerationTopics(!!isLogin);

  return (
    <GenerationTopicStoreProvider value={{ namespace, useStore: useStore as any }}>
      <Suspense fallback={<SkeletonList rows={6} />}>
        <Flexbox gap={4} paddingBlock={1}>
          <TopicList viewMode={viewMode} />
          <TopicUrlSync />
        </Flexbox>
      </Suspense>
    </GenerationTopicStoreProvider>
  );
});

export default List;
