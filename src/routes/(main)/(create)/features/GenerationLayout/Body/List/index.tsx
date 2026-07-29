'use client';

import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import NavSkeletonList from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

import type { GenerationLayoutCommonProps } from '../../types';
import GridSkeletonList from './SkeletonList';
import { GenerationTopicStoreProvider } from './StoreContext';
import TopicList from './TopicList';
import TopicUrlSync from './TopicUrlSync';

const List = memo<
  Pick<GenerationLayoutCommonProps, 'namespace' | 'useStore' | 'viewModeStatusKey'> & {
    visibility?: 'private' | 'public';
  }
>(({ namespace, useStore, viewModeStatusKey, visibility }) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const viewMode = useGlobalStore((s) => systemStatusSelectors[viewModeStatusKey](s));

  const useFetchGenerationTopics = useStore((s: any) => s.useFetchGenerationTopics);
  const { data, isLoading } = useFetchGenerationTopics(!!isLogin) ?? {};

  if (isLogin && isLoading && !data) {
    return viewMode === 'list' ? <NavSkeletonList rows={3} /> : <GridSkeletonList />;
  }

  return (
    <GenerationTopicStoreProvider value={{ namespace, useStore: useStore as any }}>
      <Flexbox gap={4} paddingBlock={1}>
        <TopicList viewMode={viewMode} visibility={visibility} />
        <TopicUrlSync />
      </Flexbox>
    </GenerationTopicStoreProvider>
  );
});

export default List;
