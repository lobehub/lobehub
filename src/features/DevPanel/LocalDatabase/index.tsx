'use client';

import { Button, Spin } from '@lobehub/ui';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import CollectionList from './CollectionList';
import {
  createLocalDatabaseTableRows,
  getLocalDatabaseColumns,
  type LocalDatabaseColumn,
} from './model';
import RecordDetails from './RecordDetails';
import RecordTable from './RecordTable';
import { useLocalDatabaseInspector } from './useLocalDatabaseInspector';

const KEY_ONLY_COLUMNS: LocalDatabaseColumn[] = [{ id: '__key', label: 'key' }];

const LocalDatabasePanel = () => {
  const {
    collections,
    error,
    isLoading,
    isRecordLoading,
    keys,
    matchingCount,
    refresh,
    resources,
    search,
    selectCollection,
    selectKey,
    selectResource,
    selectedCollection,
    selectedEntry,
    selectedKey,
    selectedResource,
    setSearch,
  } = useLocalDatabaseInspector();

  const rows = createLocalDatabaseTableRows(keys);
  const columns = rows.length > 0 ? getLocalDatabaseColumns(rows) : KEY_ONLY_COLUMNS;
  const totalCount =
    (selectedResource
      ? resources.find(({ name }) => name === selectedResource)
      : collections.find(({ name }) => name === selectedCollection)
    )?.entryCount ?? 0;

  if (error) {
    return (
      <div className={devDockPanelStyles.root}>
        <div className={styles.error}>
          <span>Could not read the local database: {error}</span>
          <Button size={'small'} onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (isLoading && collections.length === 0) {
    return (
      <div className={devDockPanelStyles.root}>
        <div className={styles.empty}>
          <Spin />
        </div>
      </div>
    );
  }

  return (
    <div className={devDockPanelStyles.root}>
      <div className={styles.workspace}>
        <CollectionList
          collections={collections}
          resources={resources}
          selectedCollection={selectedCollection}
          selectedResource={selectedResource}
          onSelectCollection={(name) => void selectCollection(name)}
          onSelectResource={(resource) => void selectResource(resource)}
        />
        <RecordTable
          columns={columns}
          isLoading={isLoading}
          matchingCount={matchingCount}
          rowSearch={search}
          rows={rows}
          selectedKey={selectedKey}
          title={selectedResource ?? selectedCollection ?? 'Local Database'}
          totalCount={totalCount}
          onRefresh={() => void refresh()}
          onRowSearchChange={(value) => void setSearch(value)}
          onSelect={(key) => void selectKey(key)}
        />
        <RecordDetails
          entry={selectedEntry}
          isLoading={isRecordLoading}
          key={selectedCollection ?? ''}
          selectedKey={selectedKey}
        />
      </div>
    </div>
  );
};

export default LocalDatabasePanel;
