'use client';

import { Button, Spin } from '@lobehub/ui';
import { useMemo, useState } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import CollectionList from './CollectionList';
import {
  createLocalDatabaseTableRows,
  filterLocalDatabaseRows,
  filterRowsByResource,
  getLocalDatabaseColumns,
  getReplicaResourceGroups,
  type LocalDatabaseColumn,
} from './model';
import RecordDetails from './RecordDetails';
import RecordTable, { MAX_RENDERED_ROWS } from './RecordTable';
import { useLocalDatabaseInspector } from './useLocalDatabaseInspector';

const EMPTY_COLUMNS: LocalDatabaseColumn[] = [
  { id: '__key', label: 'key' },
  { id: 'value', label: 'value' },
];

const LocalDatabasePanel = () => {
  const { collections, entries, error, isLoading, refresh, selectCollection, selectedCollection } =
    useLocalDatabaseInspector();
  const [rowSearch, setRowSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedResource, setSelectedResource] = useState<string | null>(null);

  const tableRows = useMemo(() => createLocalDatabaseTableRows(entries), [entries]);
  const resources = useMemo(() => getReplicaResourceGroups(tableRows), [tableRows]);
  const activeResource = resources.some(({ name }) => name === selectedResource)
    ? selectedResource
    : null;
  const resourceRows = useMemo(
    () => filterRowsByResource(tableRows, activeResource),
    [activeResource, tableRows],
  );
  const columns = useMemo(() => {
    const resolved = getLocalDatabaseColumns(resourceRows);
    return resolved.length > 0 ? resolved : EMPTY_COLUMNS;
  }, [resourceRows]);
  const matchingRows = useMemo(
    () => filterLocalDatabaseRows(resourceRows, rowSearch),
    [resourceRows, rowSearch],
  );
  const renderedRows = matchingRows.slice(0, MAX_RENDERED_ROWS);
  const selectedRow =
    renderedRows.find(({ entry }) => entry.key === selectedKey) ?? renderedRows.at(0);

  const resetSelection = () => {
    setRowSearch('');
    setSelectedKey(null);
  };

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
          selectedResource={activeResource}
          onSelectCollection={(name) => {
            resetSelection();
            setSelectedResource(null);
            void selectCollection(name);
          }}
          onSelectResource={(resource) => {
            resetSelection();
            setSelectedResource(resource);
          }}
        />
        <RecordTable
          columns={columns}
          isLoading={isLoading}
          matchingCount={matchingRows.length}
          rowSearch={rowSearch}
          rows={renderedRows}
          selectedKey={selectedRow?.entry.key}
          title={activeResource ?? selectedCollection ?? 'Local Database'}
          totalCount={resourceRows.length}
          onRefresh={() => void refresh()}
          onRowSearchChange={setRowSearch}
          onSelect={setSelectedKey}
        />
        <RecordDetails key={selectedCollection ?? ''} row={selectedRow} />
      </div>
    </div>
  );
};

export default LocalDatabasePanel;
