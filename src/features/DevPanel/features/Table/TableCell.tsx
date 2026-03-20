import dayjs from 'dayjs';
import { get, isDate } from 'es-toolkit/compat';
import React, { useMemo } from 'react';

interface TableCellProps {
  column: string;
  dataItem: any;
  rowIndex: number;
}

const TableCell = ({ dataItem, column }: TableCellProps) => {
  const data = get(dataItem, column);
  const content = useMemo(() => {
    if (isDate(data)) return dayjs(data).format('YYYY-MM-DD HH:mm:ss');

    switch (typeof data) {
      case 'object': {
        return JSON.stringify(data);
      }

      case 'boolean': {
        return data ? 'True' : 'False';
      }

      default: {
        return data;
      }
    }
  }, [data]);

  return (
    <td key={column}>
      {/* Cannot use antd's Text component — it causes excessive re-renders that make scrolling extremely sluggish */}
      {content}
    </td>
  );
};

export default TableCell;
