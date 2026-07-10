'use client';

import { Flexbox } from '@lobehub/ui';
import { useRef } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';

import type { ResourceQueryParams } from '@/types/resource';

import ListViewDropZone from './ListViewDropZone';
import ListViewHeader from './ListViewHeader';
import ListViewSkeleton from './Skeleton';
import { styles } from './styles';
import { useExplorerListData } from './useExplorerListData';
import VirtualizedFileList from './VirtualizedFileList';

interface ListViewProps {
  isLoading?: boolean;
  isValidating?: boolean;
  queryParams: ResourceQueryParams;
}

const ListView = ({ isLoading, isValidating, queryParams }: ListViewProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const { columnWidths, currentFolderId, data, hasMore, showSkeleton } = useExplorerListData({
    isLoading,
    isValidating,
    queryParams,
  });
  const showUploader = queryParams.visibility !== 'private';

  if (showSkeleton)
    return <ListViewSkeleton columnWidths={columnWidths} showUploader={showUploader} />;

  return (
    <Flexbox height={'100%'}>
      <div className={styles.scrollContainer}>
        <ListViewHeader
          columnWidths={columnWidths}
          data={data}
          hasMore={hasMore}
          showUploader={showUploader}
        />
        <ListViewDropZone currentFolderId={currentFolderId} virtuosoRef={virtuosoRef}>
          <VirtualizedFileList
            columnWidths={columnWidths}
            data={data}
            hasMore={hasMore}
            showUploader={showUploader}
            virtuosoRef={virtuosoRef}
          />
        </ListViewDropZone>
      </div>
    </Flexbox>
  );
};

export default ListView;
