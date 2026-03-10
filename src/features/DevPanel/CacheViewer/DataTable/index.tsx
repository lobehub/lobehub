'use client';

import { RefreshCw } from 'lucide-react';
import { memo } from 'react';

import Header from '../../features/Header';
import Table from '../../features/Table';
import { useCachePanelContext } from '../cacheProvider';

const DataTable = memo(() => {
  const { entries, isLoading, refreshData } = useCachePanelContext();
  return (
    <>
      <Header
        title="Cache Entries"
        actions={[
          {
            icon: RefreshCw,
            onClick: () => refreshData(),
            title: 'Refresh',
          },
        ]}
      />
      <Table
        columns={['url', 'headers.content-type', 'body', 'kind', 'tags', 'revalidate', 'timestamp']}
        dataSource={entries}
        loading={isLoading}
      />
    </>
  );
});

export default DataTable;
