'use client';

import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

import type { ProjectionTableCell } from './model';
import ProjectionCellEditorInput from './ProjectionCellEditorInput';
import { ProjectionObjectJsonEditor } from './ProjectionObjectJsonEditor';
import {
  createProjectionPropertyCell,
  getProjectionPropertyEntries,
  getProjectionPropertyKind,
  getProjectionPropertySummary,
  isProjectionPropertyContainer,
} from './propertyTree';
import type { ProjectionCellEditorController } from './useProjectionCellEditor';

const styles = createStaticStyles(({ css }) => ({
  childrenLimit: css`
    padding-block: 8px;
    padding-inline: 28px 10px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
  `,
  containerMeta: css`
    overflow: hidden;
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    min-width: 0;
    padding-block: 5px;
    padding-inline: 10px 6px;
  `,
  containerRow: css`
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    min-height: 38px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  containerSummary: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  disclosure: css`
    flex-shrink: 0;

    width: 14px;
    height: 14px;

    color: ${cssVar.colorTextTertiary};

    transition: transform ${cssVar.motionDurationFast};
  `,
  disclosureExpanded: css`
    transform: rotate(90deg);
  `,
  jsonButton: css`
    flex-shrink: 0;

    min-width: auto;
    height: 24px;
    padding-inline: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
  keyCell: css`
    overflow: hidden;
    display: flex;
    gap: 5px;
    align-items: flex-start;

    min-width: 0;
    padding-block: 7px;
    padding-inline-end: 8px;
    border: 0;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

    color: inherit;
    text-align: start;

    background: ${cssVar.colorFillQuaternary};

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  keyText: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  leafValue: css`
    overflow: auto;

    max-height: 112px;
    margin: 0;
    padding-block: 8px;
    padding-inline: 10px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.45;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  leafValueEditable: css`
    cursor: text;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
      box-shadow: inset 2px 0 0 ${cssVar.colorPrimary};
    }
  `,
  leafValueEditing: css`
    overflow: visible;
    padding-block: 3px;
    padding-inline: 0;
  `,
  name: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  nameRoot: css`
    font-weight: 650;
  `,
  nullValue: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  propertyRow: css`
    display: grid;
    grid-template-columns: 132px minmax(0, 1fr);
    min-height: 38px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  toggle: css`
    cursor: pointer;
  `,
  type: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextQuaternary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const MAX_VISIBLE_CHILDREN = 200;

interface ProjectionPropertyNodeProps {
  cell: ProjectionTableCell;
  depth: number;
  editor: ProjectionCellEditorController;
  root?: boolean;
}

const ProjectionPropertyNode = memo<ProjectionPropertyNodeProps>(
  ({ cell, depth, editor, root = false }) => {
    const container = isProjectionPropertyContainer(cell.value);
    const kind = getProjectionPropertyKind(cell.value);
    const entries = container ? getProjectionPropertyEntries(cell.value) : [];
    const [expanded, setExpanded] = useState(root && kind === 'object');
    const active = editor.activeCell?.key === cell.key;
    const indentation = 9 + Math.min(depth, 6) * 12;

    if (!container) {
      return (
        <div className={styles.propertyRow}>
          <div className={styles.keyCell} style={{ paddingInlineStart: indentation }}>
            <span aria-hidden className={styles.disclosure} />
            <span className={styles.keyText} title={cell.column.label}>
              <span className={cx(styles.name, root ? styles.nameRoot : undefined)}>
                {cell.column.label}
              </span>
              <span className={styles.type}>{kind}</span>
            </span>
          </div>
          {active ? (
            <div className={styles.leafValueEditing}>
              <ProjectionCellEditorInput cell={cell} editor={editor} />
            </div>
          ) : (
            <pre
              aria-label={`${cell.column.label} value`}
              title={cell.editTarget ? `${cell.title}\nDouble-click to edit.` : cell.title}
              className={cx(
                styles.leafValue,
                cell.editTarget ? styles.leafValueEditable : undefined,
                cell.value == null ? styles.nullValue : undefined,
              )}
              onDoubleClick={cell.editTarget ? () => void editor.begin(cell) : undefined}
            >
              {cell.displayValue}
            </pre>
          )}
        </div>
      );
    }

    return (
      <div>
        <div className={styles.containerRow}>
          <button
            aria-expanded={expanded}
            className={cx(styles.keyCell, styles.toggle)}
            style={{ paddingInlineStart: indentation }}
            type={'button'}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronRight
              aria-hidden
              className={cx(styles.disclosure, expanded ? styles.disclosureExpanded : undefined)}
            />
            <span className={styles.keyText} title={cell.column.label}>
              <span className={cx(styles.name, root ? styles.nameRoot : undefined)}>
                {cell.column.label}
              </span>
              <span className={styles.type}>{kind}</span>
            </span>
          </button>
          <div className={styles.containerMeta}>
            <span className={styles.containerSummary}>
              {getProjectionPropertySummary(cell.value)}
            </span>
            {cell.editTarget && (
              <Button
                aria-label={`Edit ${cell.column.label} as JSON`}
                aria-pressed={active}
                className={styles.jsonButton}
                disabled={editor.isApplying}
                size={'small'}
                type={'text'}
                onClick={(event) => {
                  event.stopPropagation();
                  void editor.begin(cell, { pretty: true });
                }}
              >
                JSON
              </Button>
            )}
          </div>
        </div>
        {active ? (
          <ProjectionObjectJsonEditor cell={cell} editor={editor} />
        ) : (
          expanded && (
            <>
              {entries.slice(0, MAX_VISIBLE_CHILDREN).map((entry) => {
                const childCell = createProjectionPropertyCell(cell, entry);
                return (
                  <ProjectionPropertyNode
                    cell={childCell}
                    depth={depth + 1}
                    editor={editor}
                    key={childCell.key}
                  />
                );
              })}
              {entries.length > MAX_VISIBLE_CHILDREN && (
                <div className={styles.childrenLimit}>
                  Showing the first {MAX_VISIBLE_CHILDREN} of {entries.length} entries. Use JSON to
                  edit the complete value.
                </div>
              )}
            </>
          )
        )}
      </div>
    );
  },
);

ProjectionPropertyNode.displayName = 'ProjectionPropertyNode';

interface ProjectionPropertyTreeProps {
  cell: ProjectionTableCell;
  editor: ProjectionCellEditorController;
}

export const ProjectionPropertyTree = memo<ProjectionPropertyTreeProps>(({ cell, editor }) => (
  <ProjectionPropertyNode root cell={cell} depth={0} editor={editor} />
));

ProjectionPropertyTree.displayName = 'ProjectionPropertyTree';
