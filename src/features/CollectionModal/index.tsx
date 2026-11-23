'use client';

import type { CollectionWorkItem } from '@lobechat/types';
import { createModal, Empty } from '@lobehub/ui';
import { t } from 'i18next';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';

import CollectionGrid from './CollectionGrid';
import { getCollectionModalWidth } from './layout';
import { useCollectionItems } from './useCollectionItems';

export interface CollectionModalParams {
  /**
   * The collection's images when the caller already has them (summary rows, the
   * share profile). Without them the modal loads the latest version, which only
   * the Work's owner may read.
   */
  items?: CollectionWorkItem[];
  title?: string | null;
  workId?: string;
}

const CollectionModalContent = ({
  items,
  workId,
}: Pick<CollectionModalParams, 'items' | 'workId'>) => {
  const { t } = useTranslation('chat');
  const { error, images, isLoading, retry } = useCollectionItems({ items, workId });

  return (
    <AsyncBoundary
      data={images}
      empty={<Empty description={t('workingPanel.works.collectionEmpty')} />}
      error={error}
      isEmpty={!error && !images?.length}
      isLoading={isLoading}
      onRetry={retry}
    >
      {images && <CollectionGrid items={images} />}
    </AsyncBoundary>
  );
};

export const createCollectionModal = ({ items, title, workId }: CollectionModalParams) =>
  createModal({
    content: <CollectionModalContent items={items} workId={workId} />,
    footer: null,
    maskClosable: true,
    styles: { content: { maxHeight: '75vh', overflowY: 'auto' } },
    title: title?.trim() || t('workingPanel.works.collectionUntitled', { ns: 'chat' }),
    width: getCollectionModalWidth(items?.length),
  });
