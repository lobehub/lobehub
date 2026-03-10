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
      {/* 不能使用 antd 的 Text， 会有大量的重渲染导致滚动极其卡顿 */}
      {content}
    </td>
  );
};

export default TableCell;
