'use client';

import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo, useState } from 'react';

import type { ProjectionTableDefinition, ProjectionTableRow } from './model';
import { createProjectionTableCell, createProjectionTableColumns } from './model';
import { ProjectionPropertyTree } from './ProjectionPropertyTree';
import type { ProjectionCellEditorController } from './useProjectionCellEditor';

const styles = createStaticStyles(({ css }) => ({
  identity: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    gap: 5px;
    align-items: center;

    min-height: 38px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  identityPart: css`
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  identitySeparator: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextQuaternary};
  `,
  raw: css`
    overflow: auto;

    height: 100%;
    margin: 0;
    padding: 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  tabList: css`
    flex-shrink: 0;
    padding-block: 4px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  tabPanel: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  tabs: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
}));

type InspectorView = 'data' | 'raw';

interface ProjectionInspectorProps {
  editor: ProjectionCellEditorController;
  row: ProjectionTableRow;
  table: ProjectionTableDefinition | null;
}

const ProjectionInspector = memo<ProjectionInspectorProps>(({ editor, row, table }) => {
  const [activeView, setActiveView] = useState<InspectorView>('data');
  const cells = useMemo(
    () =>
      createProjectionTableColumns([row], table)
        .filter(({ kind }) => kind !== 'identity')
        .map((column) => {
          const cell = createProjectionTableCell(row, column);
          return { ...cell, key: `${cell.key}:inspector` };
        }),
    [row, table],
  );

  return (
    <>
      <div className={styles.identity} title={`${row.scope}/${table?.label}/${row.identity}`}>
        <span className={styles.identityPart}>{row.scope}</span>
        <span className={styles.identitySeparator}>/</span>
        <span className={styles.identityPart}>{table?.label}</span>
        <span className={styles.identitySeparator}>/</span>
        <span className={styles.identityPart}>{row.identity}</span>
      </div>
      <Tabs
        activeKey={activeView}
        className={styles.tabs}
        classNames={{ list: styles.tabList, panel: styles.tabPanel }}
        size={'small'}
        variant={'square'}
        items={[
          {
            children: (
              <div>
                {cells.map((cell) => (
                  <ProjectionPropertyTree cell={cell} editor={editor} key={cell.key} />
                ))}
              </div>
            ),
            key: 'data',
            label: 'Data',
          },
          {
            children: <pre className={styles.raw}>{JSON.stringify(row.value, null, 2)}</pre>,
            key: 'raw',
            label: 'Raw',
          },
        ]}
        onChange={(key) => {
          void editor.commit().then((committed) => {
            if (committed) setActiveView(key as InspectorView);
          });
        }}
      />
    </>
  );
});

ProjectionInspector.displayName = 'ProjectionInspector';

export default ProjectionInspector;
