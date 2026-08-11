'use client';

import { Input } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { Layers3 } from 'lucide-react';
import { memo } from 'react';

import { devDockPanelStyles } from '@/features/DevDock/panelStyles';

import ProjectionEditor from './ProjectionEditor';
import { useProjectionInspector } from './useProjectionInspector';

const styles = createStaticStyles(({ css }) => ({
  detailsBody: css`
    overflow: auto;
    display: flex;
    flex: 1;
    flex-direction: column;

    min-height: 0;
  `,
  detailsPane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;

    @media (width <= 900px) {
      display: none;
    }
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 0;
    padding: 24px;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  identity: css`
    display: grid;
    gap: 6px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  raw: css`
    overflow: auto;

    margin: 0;
    padding: 12px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  rowActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  scopeCount: css`
    flex-shrink: 0;

    min-width: 24px;
    padding-inline: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusXS};

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  scopeIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  scopeItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    padding-block: 4px;
    padding-inline: 12px;
    border: 0;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
    text-align: start;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }
  `,
  scopeItemActive: css`
    color: ${cssVar.colorText};
    background: ${cssVar.colorFillSecondary};
  `,
  scopeList: css`
    overflow: auto;
    flex: 1;
    min-height: 0;
    padding-block: 4px;
  `,
  scopeMeta: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
  `,
  scopeName: css`
    overflow: hidden;
    font-family: ${cssVar.fontFamilyCode};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  scopePane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  scopeStatus: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 10px;
    color: ${cssVar.colorTextTertiary};
  `,
  table: css`
    table-layout: fixed;
    border-spacing: 0;
    border-collapse: separate;

    width: 100%;
    min-width: 900px;

    th,
    td {
      overflow: hidden;

      height: 32px;
      padding-inline: 8px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};

      font-family: ${cssVar.fontFamilyCode};
      font-size: ${cssVar.fontSizeSM};
      color: ${cssVar.colorTextSecondary};
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    th {
      position: sticky;
      z-index: 1;
      inset-block-start: 0;

      font-family: ${cssVar.fontFamily};
      font-weight: 600;
      color: ${cssVar.colorText};

      background: ${cssVar.colorBgContainer};
    }

    th:last-child,
    td:last-child {
      border-inline-end: 0;
    }

    tbody tr {
      cursor: pointer;
      outline: none;
    }

    tbody tr:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    tbody tr:focus-visible {
      box-shadow: inset 0 0 0 2px ${cssVar.colorPrimary};
    }
  `,
  tablePane: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    min-width: 0;
    min-height: 0;
  `,
  tableScroll: css`
    position: relative;
    overflow: auto;
    flex: 1;
    min-height: 0;
  `,
  toolbarMeta: css`
    flex-shrink: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  toolbarSearch: css`
    min-width: 140px;
    max-width: 320px;
  `,
  toolbarTitle: css`
    overflow: hidden;
    flex: 1;

    min-width: 100px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  workspace: css`
    overflow: hidden;
    display: grid;
    grid-template-columns: 220px minmax(400px, 1fr) 340px;
    flex: 1;

    min-height: 0;

    @media (width <= 1200px) {
      grid-template-columns: 190px minmax(360px, 1fr) 300px;
    }

    @media (width <= 900px) {
      grid-template-columns: 180px minmax(0, 1fr);
    }

    @media (width <= 560px) {
      grid-template-columns: 140px minmax(0, 1fr);
    }
  `,
}));

const formatTimestamp = (timestamp: number | undefined): string =>
  timestamp === undefined ? '—' : new Date(timestamp).toISOString();

const ProjectionPanel = memo(() => {
  const {
    matchingRows,
    rowSearch,
    scopeSearch,
    selectRecord,
    selectScope,
    selectedRow,
    selectedScope,
    setRowSearch,
    setScopeSearch,
    visibleScopeRows,
  } = useProjectionInspector();

  return (
    <div className={devDockPanelStyles.root}>
      <div className={styles.workspace}>
        <aside
          aria-label={'Projection scopes'}
          className={cx(styles.scopePane, devDockPanelStyles.paneDividerEnd)}
        >
          <div className={devDockPanelStyles.paneHeader}>Scopes</div>
          <div className={devDockPanelStyles.paneSearch}>
            <Input
              allowClear
              className={devDockPanelStyles.searchInput}
              placeholder={'Search scopes…'}
              size={'small'}
              value={scopeSearch}
              variant={'borderless'}
              onChange={(event) => setScopeSearch(event.target.value)}
            />
          </div>
          <div className={styles.scopeList}>
            {visibleScopeRows.length === 0 ? (
              <div className={styles.empty}>
                {scopeSearch ? 'No scopes match.' : 'No Projection scopes are loaded.'}
              </div>
            ) : (
              visibleScopeRows.map(({ hydrationStatus, recordCount, scope }) => (
                <button
                  aria-pressed={scope === selectedScope}
                  key={scope}
                  title={scope}
                  type={'button'}
                  className={cx(
                    styles.scopeItem,
                    scope === selectedScope && styles.scopeItemActive,
                  )}
                  onClick={() => selectScope(scope)}
                >
                  <Layers3 className={styles.scopeIcon} size={14} />
                  <span className={styles.scopeMeta}>
                    <span className={styles.scopeName}>{scope}</span>
                    <span className={styles.scopeStatus}>{hydrationStatus}</span>
                  </span>
                  <span className={styles.scopeCount}>{recordCount}</span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className={styles.tablePane}>
          <div className={devDockPanelStyles.toolbar}>
            <span className={styles.toolbarTitle} title={selectedScope ?? undefined}>
              {selectedScope ?? 'Projection'}
            </span>
            <Input
              allowClear
              className={styles.toolbarSearch}
              disabled={!selectedScope}
              placeholder={'Search records…'}
              size={'small'}
              value={rowSearch}
              onChange={(event) => setRowSearch(event.target.value)}
            />
            <span className={styles.toolbarMeta}>{matchingRows.length} records</span>
            <span className={styles.toolbarMeta}>live store</span>
          </div>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 220 }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope={'col'}>kind</th>
                  <th scope={'col'}>id</th>
                  <th scope={'col'}>fragments</th>
                  <th scope={'col'}>source</th>
                  <th scope={'col'}>observed_at</th>
                </tr>
              </thead>
              <tbody>
                {matchingRows.map((row) => {
                  const { projection } = row;
                  const active = projection.entryKey === selectedRow?.projection.entryKey;
                  return (
                    <tr
                      aria-label={`${projection.record.kind}/${projection.record.id}`}
                      aria-selected={active}
                      className={active ? styles.rowActive : undefined}
                      key={projection.entryKey}
                      tabIndex={0}
                      onClick={() => selectRecord(projection.entryKey)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectRecord(projection.entryKey);
                        }
                      }}
                    >
                      <td title={projection.record.kind}>{projection.record.kind}</td>
                      <td title={projection.record.id}>{projection.record.id}</td>
                      <td title={row.fragmentNames.join(', ')}>
                        {row.fragmentNames.join(', ') || '—'}
                      </td>
                      <td title={row.sources.join(', ')}>{row.sources.join(', ') || '—'}</td>
                      <td title={formatTimestamp(row.latestObservedAt)}>
                        {formatTimestamp(row.latestObservedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {matchingRows.length === 0 && (
              <div className={styles.empty}>
                {rowSearch
                  ? `No records match “${rowSearch}”.`
                  : selectedScope
                    ? 'This scope has no records.'
                    : 'Open a surface that hydrates Projection data.'}
              </div>
            )}
          </div>
          <div className={devDockPanelStyles.statusBar}>
            <span>{matchingRows.length} records</span>
            <span>Projection Store</span>
          </div>
        </main>

        <aside
          aria-label={'Selected Projection record'}
          className={cx(styles.detailsPane, devDockPanelStyles.paneDividerStart)}
        >
          <div className={devDockPanelStyles.paneHeader}>Record</div>
          {selectedRow ? (
            <div className={styles.detailsBody}>
              <div className={cx(devDockPanelStyles.flatSection, styles.identity)}>
                <span>{selectedRow.projection.scope}</span>
                <span>
                  {selectedRow.projection.record.kind}/{selectedRow.projection.record.id}
                </span>
              </div>
              {selectedRow.fragmentNames.length > 0 ? (
                <ProjectionEditor
                  key={selectedRow.projection.entryKey}
                  projection={selectedRow.projection}
                />
              ) : (
                <div className={styles.empty}>This record has no editable fragments.</div>
              )}
              <pre className={styles.raw}>
                {JSON.stringify(selectedRow.projection.record, null, 2)}
              </pre>
            </div>
          ) : (
            <div className={styles.empty}>Select a Projection record.</div>
          )}
        </aside>
      </div>
    </div>
  );
});

ProjectionPanel.displayName = 'DevProjectionPanel';

export default ProjectionPanel;
