import * as stylex from '@stylexjs/stylex';
import { Fragment, memo } from 'react';

import type { BodyItem, SheetOutline, SheetSection } from './classifySheet';
import type { CellModel } from './model';
import { styles } from './styles';

const alignOf = (cell: CellModel) =>
  cell.s.h === 'right' ? 'right' : cell.s.h === 'center' ? 'center' : undefined;

const SectionTable = memo<{
  header: CellModel[];
  rows: Extract<BodyItem, { extras: CellModel[] }>[];
}>(({ header, rows }) => {
  const columns = header.map((cell) => cell.c);

  return (
    <div {...stylex.props(styles.tableContainer)}>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th
                {...stylex.props(styles.tableHead)}
                data-align={index === 0 ? undefined : alignOf(cell)}
                key={cell.c}
              >
                {cell.t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const byColumn = new Map(row.cells.map((cell) => [cell.c, cell]));
            return (
              <tr data-total={row.kind === 'total' ? '' : undefined} key={rowIndex}>
                {columns.map((column, columnIndex) => {
                  const cell = byColumn.get(column);
                  const extras =
                    columnIndex === columns.length - 1 && row.extras.length > 0
                      ? row.extras.map((item) => item.t).join(' · ')
                      : '';
                  if (!cell)
                    return (
                      <td {...stylex.props(styles.tableCell)} key={column}>
                        {extras ? <span {...stylex.props(styles.extra)}>{extras}</span> : null}
                      </td>
                    );
                  return (
                    <td {...stylex.props(styles.tableCell)} data-align={alignOf(cell)} key={column}>
                      {cell.t}
                      {extras ? <span {...stylex.props(styles.extra)}>{extras}</span> : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});

SectionTable.displayName = 'SectionTable';

const KeyValueList = memo<{ bodyFontSize: number; rows: CellModel[][] }>(
  ({ bodyFontSize, rows }) => (
    <dl {...stylex.props(styles.kv)}>
      {rows.map((cells, index) => {
        const [label, ...rest] = cells;
        return (
          <Fragment key={index}>
            <dt {...stylex.props(styles.kvLabel)}>{label.t}</dt>
            <dd {...stylex.props(styles.kvValue)}>
              {rest.length === 0
                ? '—'
                : rest.map((cell, cellIndex) => (
                    <span
                      key={cell.c}
                      {...stylex.props(
                        cell.s.bg && cell.s.b
                          ? styles.chip
                          : (cell.s.fs ?? 11) < bodyFontSize
                            ? styles.hint
                            : undefined,
                      )}
                    >
                      {cellIndex > 0 ? ' ' : ''}
                      {cell.t}
                    </span>
                  ))}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  ),
);

KeyValueList.displayName = 'KeyValueList';

const SectionBlock = memo<{ bodyFontSize: number; section: SheetSection }>(
  ({ bodyFontSize, section }) => {
    const tableRows = section.body.filter(
      (item): item is Extract<BodyItem, { extras: CellModel[] }> => item.kind !== 'kv',
    );
    const listRows = section.body.filter((item) => item.kind === 'kv').map((item) => item.cells);

    return (
      <section {...stylex.props(styles.section)}>
        {section.title ? (
          <div {...stylex.props(styles.sectionHead)}>
            <span>{section.title}</span>
            <span {...stylex.props(styles.sectionRule)} />
          </div>
        ) : null}
        {section.header && tableRows.length > 0 ? (
          <SectionTable header={section.header} rows={tableRows} />
        ) : null}
        {listRows.length > 0 ? <KeyValueList bodyFontSize={bodyFontSize} rows={listRows} /> : null}
        {section.notes.length > 0 ? (
          <div {...stylex.props(styles.hint)}>
            {section.notes.map((note, index) => (
              <div key={index}>{note}</div>
            ))}
          </div>
        ) : null}
      </section>
    );
  },
);

SectionBlock.displayName = 'SectionBlock';

interface SheetDocumentProps {
  outline: SheetOutline;
}

const SheetDocument = memo<SheetDocumentProps>(({ outline }) => (
  <div {...stylex.props(styles.container)}>
    <div {...stylex.props(styles.doc)}>
      {outline.title || outline.subtitle ? (
        <div {...stylex.props(styles.docHead)}>
          {outline.title ? <div {...stylex.props(styles.docTitle)}>{outline.title.t}</div> : null}
          {outline.subtitle ? (
            <div {...stylex.props(styles.docSubtitle)}>{outline.subtitle.t}</div>
          ) : null}
        </div>
      ) : null}
      {outline.sections.map((section, index) => (
        <SectionBlock bodyFontSize={outline.bodyFontSize} key={index} section={section} />
      ))}
    </div>
  </div>
));

SheetDocument.displayName = 'SheetDocument';

export default SheetDocument;
