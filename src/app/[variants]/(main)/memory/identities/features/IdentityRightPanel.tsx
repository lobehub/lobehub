'use client';

import { Text } from '@lobehub/ui';
import { memo } from 'react';

import CateTag from '@/app/[variants]/(main)/memory/features/CateTag';
import DetailLoading from '@/app/[variants]/(main)/memory/features/DetailLoading';
import DetailPanel from '@/app/[variants]/(main)/memory/features/DetailPanel';
import HashTags from '@/app/[variants]/(main)/memory/features/HashTags';
import HighlightedContent from '@/app/[variants]/(main)/memory/features/HighlightedContent';
import Time from '@/app/[variants]/(main)/memory/features/Time';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { useQueryState } from '@/hooks/useQueryParam';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

import IdentityDropdown from './IdentityDropdown';

const IdentityRightPanel = memo(() => {
  const [identityId] = useQueryState('identityId', { clearOnDefault: true });
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);

  const { data: identity, isLoading } = useFetchMemoryDetail(identityId, LayersEnum.Identity);

  if (!identityId) return null;

  let content;
  if (isLoading) content = <DetailLoading />;
  if (identity) {
    content = (
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
  }

  return (
    <DetailPanel
      header={{
        right: identityId ? (
          <IdentityDropdown id={identityId} size={DESKTOP_HEADER_ICON_SIZE} />
        ) : undefined,
      }}
    >
      {content}
    </DetailPanel>
  );
});

export default IdentityRightPanel;
