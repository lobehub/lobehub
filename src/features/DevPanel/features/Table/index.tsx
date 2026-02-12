import { Center, Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import React from 'react';
import { TableVirtuoso } from 'react-virtuoso';

import TableCell from './TableCell';

const styles = createStaticStyles(({ css, cssVar }) => ({
  columnList: css`
    margin-inline-start: 32px;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    > div {
      padding-block: ${cssVar.paddingXS};
      padding-inline: 0;
    }
  `,
  table: css`
    overflow: scroll hidden;
    flex: 1;

    table {
      border-collapse: collapse;
      width: 100%;
      margin-inline-end: 12px;
      font-family: ${cssVar.fontFamilyCode};
    }

    thead {
      tr {
        outline: 1px solid ${cssVar.colorBorderSecondary};
      }
    }

    th,
    td {
      overflow: hidden;

      max-width: 200px;
      padding-block: 8px;
      padding-inline: 12px;
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

      font-size: 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      font-weight: ${cssVar.fontWeightStrong};
      text-align: start;
      text-wrap: nowrap;

      background: ${cssVar.colorBgElevated};
    }

    td {
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      text-wrap: nowrap;
    }

    tbody {
      tr:hover {
        background: ${cssVar.colorFillTertiary};
      }
    }
  `,
  tableItem: css`
    cursor: pointer;

    display: flex;
    gap: ${cssVar.padding};
    align-items: center;

    padding: 12px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};
  `,
}));

interface TableProps {
  columns: string[];
  dataSource: any[];
  loading?: boolean;
}

const Table = ({ columns, dataSource, loading }: TableProps) => {
  if (loading)
    return (
      <Center height={'100%'}>
        <Icon spin icon={Loader2Icon} />
      </Center>
    );

  const header = (
    <tr>
      {columns.map((column) => (
        <th key={column}>{column}</th>
      ))}
    </tr>
  );

  return (
    <div className={styles.table}>
      {dataSource.length === 0 ? (
        <>
          <table>
            <thead>{header}</thead>
          </table>
          <Center height={400}>no rows</Center>
        </>
      ) : (
        <TableVirtuoso
          data={dataSource}
          fixedHeaderContent={() => header}
          itemContent={(index, row) => (
            <>
              {columns.map((column) => (
                <TableCell
                  column={column}
                  dataItem={row}
                  key={`${column}_${index}`}
                  rowIndex={index}
                />
              ))}
            </>
          )}
        />
      )}
    </div>
  );
};

export default Table;
