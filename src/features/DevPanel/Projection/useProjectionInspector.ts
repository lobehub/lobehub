import { useMemo, useState } from 'react';

import { useProjectionStore } from '@/projection/store';

import {
  createProjectionTableColumns,
  createProjectionTableRows,
  createProjectionTableSummaries,
  filterProjectionTableRows,
  filterProjectionTableSummaries,
  type ProjectionTableId,
} from './model';

export const useProjectionInspector = () => {
  const scopes = useProjectionStore((state) => state.scopes);
  const [tableSearch, setTableSearch] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const [requestedTableId, setRequestedTableId] = useState<ProjectionTableId | null>(null);
  const [requestedRecordKey, setRequestedRecordKey] = useState<string | null>(null);

  const tables = useMemo(() => createProjectionTableSummaries(scopes), [scopes]);
  const visibleTables = useMemo(
    () => filterProjectionTableSummaries(tables, tableSearch),
    [tableSearch, tables],
  );
  const selectedTable =
    (requestedTableId && tables.find(({ id }) => id === requestedTableId)) ||
    tables.find(({ rowCount }) => rowCount > 0) ||
    tables.at(0) ||
    null;
  const rows = useMemo(
    () => createProjectionTableRows(scopes, selectedTable?.id ?? null),
    [scopes, selectedTable?.id],
  );
  const columns = useMemo(
    () => createProjectionTableColumns(rows, selectedTable),
    [rows, selectedTable],
  );
  const matchingRows = useMemo(() => filterProjectionTableRows(rows, rowSearch), [rowSearch, rows]);
  const selectedRow =
    matchingRows.find(({ rowKey }) => rowKey === requestedRecordKey) ?? matchingRows.at(0);

  return {
    columns,
    matchingRows,
    rowSearch,
    selectRecord: setRequestedRecordKey,
    selectTable: (tableId: ProjectionTableId) => {
      setRequestedRecordKey(null);
      setRequestedTableId(tableId);
      setRowSearch('');
    },
    selectedRow,
    selectedTable,
    setRowSearch,
    setTableSearch,
    tableSearch,
    tables,
    visibleTables,
  };
};
