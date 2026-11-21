import { useMemo, useState, useSyncExternalStore } from 'react';

import {
  getReplicaDevtoolsVersion,
  listReplicaDevtools,
  subscribeReplicaDevtools,
} from '@/libs/replica/devtools';

import {
  createReplicaEntryRows,
  filterReplicaEntryRows,
  filterReplicaResources,
  summarizeReplicaResource,
} from './model';

export const MAX_RENDERED_ENTRIES = 300;

export const useReplicaInspector = () => {
  const version = useSyncExternalStore(
    subscribeReplicaDevtools,
    getReplicaDevtoolsVersion,
    getReplicaDevtoolsVersion,
  );
  const [resourceSearch, setResourceSearch] = useState('');
  const [entrySearch, setEntrySearch] = useState('');
  const [requestedNamespace, setRequestedNamespace] = useState<string | null>(null);
  const [requestedKey, setRequestedKey] = useState<string | null>(null);

  const snapshot = useMemo(() => ({ registry: listReplicaDevtools(), version }), [version]);
  const { registry } = snapshot;
  const resources = useMemo(() => registry.map(summarizeReplicaResource), [registry]);
  const visibleResources = filterReplicaResources(resources, resourceSearch);

  const selected =
    registry.find(({ resource }) => resource.namespace === requestedNamespace) ??
    registry.find((entry) => entry.keys().length > 0) ??
    registry.at(0);
  const rows = useMemo(
    () => (selected ? createReplicaEntryRows(selected) : []),
    [selected, snapshot],
  );
  const matchingRows = filterReplicaEntryRows(rows, entrySearch);
  const renderedRows = matchingRows.slice(0, MAX_RENDERED_ENTRIES);
  const selectedRow = renderedRows.find(({ key }) => key === requestedKey) ?? renderedRows.at(0);

  return {
    entrySearch,
    matchingCount: matchingRows.length,
    renderedRows,
    resourceSearch,
    resources,
    selectEntry: setRequestedKey,
    selectResource: (namespace: string) => {
      setRequestedNamespace(namespace);
      setRequestedKey(null);
      setEntrySearch('');
    },
    selected,
    selectedRow,
    setEntrySearch,
    setResourceSearch,
    totalCount: rows.length,
    visibleResources,
  };
};
