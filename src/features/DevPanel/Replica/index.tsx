'use client';

import * as stylex from '@stylexjs/stylex';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import { inspectorStyles as styles } from '../inspectorStyles';
import EntryDetails from './EntryDetails';
import EntryTable from './EntryTable';
import ResourceList from './ResourceList';
import { useReplicaInspector } from './useReplicaInspector';

const ReplicaPanel = () => {
  const {
    entrySearch,
    matchingCount,
    renderedRows,
    resourceSearch,
    selectEntry,
    selectResource,
    selected,
    selectedRow,
    setEntrySearch,
    setResourceSearch,
    totalCount,
    visibleResources,
  } = useReplicaInspector();
  const namespace = selected?.resource.namespace;

  return (
    <div {...stylex.props(devDockPanelStyles.root)}>
      <div {...stylex.props(styles.workspace)}>
        <ResourceList
          resources={visibleResources}
          search={resourceSearch}
          selectedNamespace={namespace}
          onSearchChange={setResourceSearch}
          onSelect={selectResource}
        />
        <EntryTable
          matchingCount={matchingCount}
          rows={renderedRows}
          search={entrySearch}
          selectedKey={selectedRow?.key}
          title={selected?.resource.name ?? 'Replica'}
          totalCount={totalCount}
          onRevalidate={selected ? () => void selected.revalidate() : undefined}
          onSearchChange={setEntrySearch}
          onSelect={selectEntry}
        />
        <EntryDetails
          entry={selected}
          key={`${namespace}\u0000${selectedRow?.key}`}
          row={selectedRow}
          onPin={selectEntry}
        />
      </div>
    </div>
  );
};

export default ReplicaPanel;
