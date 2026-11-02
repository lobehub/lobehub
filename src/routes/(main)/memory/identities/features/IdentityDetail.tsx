'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import CateTag from '@/routes/(main)/memory/features/CateTag';
import DetailLoading from '@/routes/(main)/memory/features/DetailLoading';
import DetailNotFound from '@/routes/(main)/memory/features/DetailNotFound';
import HashTags from '@/routes/(main)/memory/features/HashTags';
import HighlightedContent from '@/routes/(main)/memory/features/HighlightedContent';
import Time from '@/routes/(main)/memory/features/Time';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

interface IdentityDetailProps {
  /** Layer-specific row id (`identityId`). */
  id: string;
}

/**
 * The identity memory detail body, shared by the memory page's right panel and the chat Portal.
 */
const IdentityDetail = memo<IdentityDetailProps>(({ id: identityId }) => {
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const {
    data: identity,
    isLoading,
    error,
    mutate,
  } = useFetchMemoryDetail(identityId, LayersEnum.Identity);

  const content = identity && (
    <>
      <CateTag cate={identity.type} />
      <Text
        as={'h1'}
        fontSize={20}
        weight={'bold'}
        style={{
          lineHeight: 1.4,
          marginBottom: 0,
        }}
      >
        {identity.title}
      </Text>
      <Time capturedAt={identity.capturedAt || identity.updatedAt || identity.createdAt} />
      {identity.description && <HighlightedContent>{identity.description}</HighlightedContent>}
      <HashTags hashTags={identity.tags} />
    </>
  );

  return (
    <AsyncBoundary
      data={identity}
      empty={<DetailNotFound />}
      error={error}
      errorVariant={'page'}
      isEmpty={!identity}
      isLoading={isLoading}
      loading={<DetailLoading />}
      onRetry={() => mutate()}
    >
      {content}
    </AsyncBoundary>
  );
});

IdentityDetail.displayName = 'IdentityDetail';

export default IdentityDetail;
