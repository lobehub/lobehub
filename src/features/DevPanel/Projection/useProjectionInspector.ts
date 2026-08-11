import { useMemo, useState } from 'react';

import { useProjectionStore } from '@/projection/store';

import {
  createProjectionScopeRows,
  createProjectionTableRows,
  filterProjectionScopeRows,
  filterProjectionTableRows,
} from './model';

export const useProjectionInspector = () => {
  const scopes = useProjectionStore((state) => state.scopes);
  const [scopeSearch, setScopeSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [requestedScope, setRequestedScope] = useState<string | null>(null);
  const [requestedRecordKey, setRequestedRecordKey] = useState<string | null>(null);

  const scopeRows = useMemo(() => createProjectionScopeRows(scopes), [scopes]);
  const visibleScopeRows = useMemo(
    () => filterProjectionScopeRows(scopeRows, scopeSearch),
    [scopeRows, scopeSearch],
  );
  const selectedScope =
    requestedScope && visibleScopeRows.some(({ scope }) => scope === requestedScope)
      ? requestedScope
      : (visibleScopeRows.at(0)?.scope ?? null);
  const rows = useMemo(
    () => createProjectionTableRows(selectedScope ?? '', scopes[selectedScope ?? '']),
    [scopes, selectedScope],
  );
  const matchingRows = useMemo(() => filterProjectionTableRows(rows, rowSearch), [rowSearch, rows]);
  const selectedRow =
    matchingRows.find(({ projection }) => projection.entryKey === requestedRecordKey) ??
    matchingRows.at(0);

  return {
    matchingRows,
    rowSearch,
    scopeRows,
    scopeSearch,
    selectRecord: setRequestedRecordKey,
    selectScope: (scope: string) => {
      setRequestedRecordKey(null);
      setRequestedScope(scope);
      setRowSearch('');
    },
    selectedRow,
    selectedScope,
    setRowSearch,
    setScopeSearch,
    visibleScopeRows,
  };
};
