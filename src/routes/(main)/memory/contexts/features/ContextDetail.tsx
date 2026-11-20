'use client';

import { Badge, Center, cssVar, Flexbox, Text, Tooltip } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import CateTag from '@/routes/(main)/memory/features/CateTag';
import DetailLoading from '@/routes/(main)/memory/features/DetailLoading';
import DetailNotFound from '@/routes/(main)/memory/features/DetailNotFound';
import HashTags from '@/routes/(main)/memory/features/HashTags';
import HighlightedContent from '@/routes/(main)/memory/features/HighlightedContent';
import ProgressIcon from '@/routes/(main)/memory/features/ProgressIcon';
import SourceLink from '@/routes/(main)/memory/features/SourceLink';
import Time from '@/routes/(main)/memory/features/Time';
import { useUserMemoryStore } from '@/store/userMemory';
import { LayersEnum } from '@/types/userMemory';

interface ContextDetailProps {
  /** Layer-specific row id (`contextId`). */
  id: string;
}

/**
 * The context memory detail body, shared by the memory page's right panel and the chat Portal.
 */
const ContextDetail = memo<ContextDetailProps>(({ id: contextId }) => {
  const useFetchMemoryDetail = useUserMemoryStore((s) => s.useFetchMemoryDetail);
  const { t } = useTranslation('memory');
  const {
    data: context,
    isLoading,
    error,
    mutate,
  } = useFetchMemoryDetail(contextId, LayersEnum.Context);

  const content = context && (
    <>
      <CateTag cate={context.type} />
      <Text
        as={'h1'}
        fontSize={20}
        weight={'bold'}
        style={{
          lineHeight: 1.4,
          marginBottom: 0,
        }}
      >
        {context.title}
        <Tooltip title={context.currentStatus}>
          <Center flex={'none'} height={20} style={{ display: 'inline-flex' }} width={20}>
            <Badge status="processing" style={{ marginLeft: 8 }} />
          </Center>
        </Tooltip>
      </Text>
      <Flexbox horizontal align="center" gap={16}>
        <ProgressIcon
          showInfo
          format={(percent) => `${t('filter.sort.scoreImpact')}: ${percent}%`}
          percent={(context.scoreImpact ?? 0) * 100}
        />
        <ProgressIcon
          showInfo
          format={(percent) => `${t('filter.sort.scoreUrgency')}: ${percent}%`}
          percent={(context.scoreUrgency ?? 0) * 100}
          strokeColor={(context.scoreUrgency ?? 0) >= 0.7 ? cssVar.colorError : cssVar.colorWarning}
        />
      </Flexbox>
      <Flexbox horizontal align="center" gap={16} justify="space-between">
        <SourceLink source={context.source} />
        <Time capturedAt={context.capturedAt || context.updatedAt || context.createdAt} />
      </Flexbox>
      <HighlightedContent>{context.description}</HighlightedContent>
      <HashTags hashTags={context.tags} />
    </>
  );

  return (
    <AsyncBoundary
      data={context}
      empty={<DetailNotFound />}
      error={error}
      errorVariant={'page'}
      isEmpty={!context}
      isLoading={isLoading}
      loading={<DetailLoading />}
      onRetry={() => mutate()}
    >
      {content}
    </AsyncBoundary>
  );
});

ContextDetail.displayName = 'ContextDetail';

export default ContextDetail;
