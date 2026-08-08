'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';

import AsyncBoundary from '@/components/AsyncBoundary';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import CateTag from '@/routes/(main)/memory/features/CateTag';
import DetailLoading from '@/routes/(main)/memory/features/DetailLoading';
import DetailNotFound from '@/routes/(main)/memory/features/DetailNotFound';
import DetailPanel from '@/routes/(main)/memory/features/DetailPanel';
import HashTags from '@/routes/(main)/memory/features/HashTags';
import HighlightedContent from '@/routes/(main)/memory/features/HighlightedContent';
import Time from '@/routes/(main)/memory/features/Time';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

import IdentityDropdown from './IdentityDropdown';

const IdentityRightPanel = memo(() => {
  const [identityId] = useQueryState('identityId', { clearOnDefault: true });
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const {
    data: identity,
    isLoading,
    error,
    mutate,
  } = useFetchMemoryDetail(identityId, LayersEnum.Identity);

  if (!identityId) return null;

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
    <DetailPanel
      header={{
        right: identityId ? (
          <IdentityDropdown id={identityId} size={DESKTOP_HEADER_ICON_SIZE} />
        ) : undefined,
      }}
    >
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
    </DetailPanel>
  );
});

export default IdentityRightPanel;
