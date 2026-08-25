'use client';

import {
  Accordion,
  AccordionItem,
  ActionIcon,
  Center,
  DraggablePanel,
  DraggablePanelContainer,
  type DraggablePanelProps,
  Empty,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import type { DropdownItem } from '@lobehub/ui/base-ui';
import { DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import {
  ArrowLeft,
  Check,
  FolderClosed,
  ListFilter,
  PanelLeftClose,
  ScrollText,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useAcceptanceList } from '../../hooks';
import type { ReportPanelExpand } from '../../Workspace/useReportPanelExpand';
import { acceptanceHomePath } from '../routes';
import {
  type AcceptanceListFilter,
  DEFAULT_ACCEPTANCE_LIST_FILTER,
  filterAcceptanceList,
  normalizeAcceptanceListFilter,
} from './acceptanceListFilter';
import AcceptanceRow from './AcceptanceRow';
import {
  expandedAcceptanceGroupKeys,
  groupAcceptanceList,
  hasProjectAcceptanceGroups,
  nextCollapsedGroupKeys,
} from './groupAcceptanceList';

const PANEL_MIN = 260;
const PANEL_MAX = 420;
const ACCEPTANCE_LIST_FILTER_STORAGE_KEY = 'lobehub-acceptance-list-filter';
const EMPTY_FILTER_KEYS = {
  active: 'acceptance.workspace.filters.empty.active',
  completed: 'acceptance.workspace.filters.empty.completed',
} as const satisfies Record<Exclude<AcceptanceListFilter, 'all'>, string>;

const styles = createStaticStyles(({ css }) => ({
  panel: css`
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
  head: css`
    flex: none;
    padding-block: 14px 6px;
    padding-inline: 12px;
  `,
  headWithBrand: css`
    flex: none;
    padding-block: 0 6px;
    padding-inline: 12px;
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline: 4px;
  `,
  titleRowWithBrand: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    min-height: 48px;
    padding-inline: 4px;
  `,
  collapseBtn: css`
    cursor: pointer;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 26px;
    border: none;
    border-radius: 4px;

    color: ${cssVar.colorTextTertiary};

    background: none;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  search: css`
    display: flex;
    gap: 7px;
    align-items: center;

    height: 32px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    svg {
      flex: none;
      color: ${cssVar.colorTextQuaternary};
    }

    input {
      width: 100%;
      min-width: 0;
      border: none;

      font-size: 13px;
      color: ${cssVar.colorText};

      background: none;
      outline: none;

      &::placeholder {
        color: ${cssVar.colorTextQuaternary};
      }
    }
  `,
  searchRow: css`
    display: flex;
    gap: 4px;
    align-items: center;

    margin-block: 8px 4px;
    margin-inline: 4px;

    > label {
      flex: 1;
      min-width: 0;
    }
  `,
  filterButton: css`
    flex: none;
  `,
  searchEmpty: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;

    padding-block: 24px;
    padding-inline: 12px;
  `,
  searchEmptyMsg: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
    word-break: break-word;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding-block: 6px 16px;
    padding-inline: 8px;
  `,
  groupList: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  groupTitle: css`
    display: inline-flex;
    gap: 6px;
    align-items: center;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  emptyState: css`
    height: 100%;
    min-height: 240px;
    padding-block: 24px;
    padding-inline: 16px;
  `,
  retryBtn: css`
    cursor: pointer;

    padding-block: 4px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorBgContainer};

    &:hover {
      border-color: ${cssVar.colorTextTertiary};
      color: ${cssVar.colorText};
    }
  `,
}));

interface AcceptanceListPanelProps extends ReportPanelExpand {
  headerLeading?: ReactNode;
  /**
   * Renders the per-project action menu. Injected by the main app rather than
   * imported here: the actions open the create-project modal and navigate to
   * `/project/:id`, neither of which exists in the standalone workbench app —
   * and a direct import would drag the project store into its bundle.
   */
  renderProjectActions?: (projectId?: string) => ReactNode;
}

/**
 * Master list of the caller's acceptance aggregates — the acceptance twin of
 * the verify workspace's ReportListPanel, sharing its visual language and the
 * same persisted panel-width preference so the two surfaces read as one family.
 */
const AcceptanceListPanel = memo<AcceptanceListPanelProps>(
  ({ expand, headerLeading, isNarrow, renderProjectActions, setExpand }) => {
    const { t } = useTranslation('verify');
    const navigate = useNavigate();
    const { acceptanceId } = useParams<{ acceptanceId: string }>();

    const { data, error, isLoading, mutate } = useAcceptanceList(true);

    // Client-side filter: the list endpoint returns the caller's full recent set
    // (bounded, no pagination), so filtering the loaded rows IS filtering the set.
    const [query, setQuery] = useState('');
    const [storedFilter, setStoredFilter] = useLocalStorageState<AcceptanceListFilter>(
      ACCEPTANCE_LIST_FILTER_STORAGE_KEY,
      DEFAULT_ACCEPTANCE_LIST_FILTER,
    );
    // Collapsed (not expanded) is the tracked set: a group that appears after
    // mount — the project a delivery was just filed into — must come in open.
    const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
    const filter = normalizeAcceptanceListFilter(storedFilter);
    const filtered = filterAcceptanceList(data ?? [], filter, query);
    const groups = groupAcceptanceList(filtered);
    const showGroups = hasProjectAcceptanceGroups(groups);
    const trimmedQuery = query.trim();

    const filterItems: DropdownItem[] = (
      [
        ['active', t('acceptance.workspace.filters.active')],
        ['all', t('acceptance.workspace.filters.all')],
        ['completed', t('acceptance.workspace.filters.completed')],
      ] as const
    ).map(([key, label]) => ({
      icon: <Icon icon={Check} style={{ opacity: filter === key ? 1 : 0 }} />,
      key,
      label,
      onClick: () => setStoredFilter(key),
    }));

    const [panelWidth, updateSystemStatus] = useGlobalStore((s) => [
      systemStatusSelectors.verifyReportPanelWidth(s),
      s.updateSystemStatus,
    ]);

    const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
      if (!size) return;
      const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
      if (!w || isEqual(w, panelWidth)) return;
      updateSystemStatus({ verifyReportPanelWidth: w });
    };

    return (
      <DraggablePanel
        className={styles.panel}
        defaultSize={{ width: panelWidth }}
        expand={expand}
        maxWidth={PANEL_MAX}
        minWidth={PANEL_MIN}
        mode={isNarrow ? 'float' : 'fixed'}
        placement={'left'}
        size={{ height: '100%', width: panelWidth }}
        onExpandChange={setExpand}
        onSizeChange={handleSizeChange}
      >
        <DraggablePanelContainer style={{ flex: 'none', height: '100%', minWidth: PANEL_MIN }}>
          <div className={headerLeading ? styles.headWithBrand : styles.head}>
            <div className={headerLeading ? styles.titleRowWithBrand : styles.titleRow}>
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={headerLeading ? 8 : 4}
                style={{ minWidth: 0 }}
              >
                {headerLeading ?? (
                  <ActionIcon
                    icon={ArrowLeft}
                    size={'small'}
                    title={t('back', { ns: 'common' })}
                    onClick={() => navigate(acceptanceHomePath())}
                  />
                )}
                <Text ellipsis strong style={{ fontSize: 15, minWidth: 0 }}>
                  {t('acceptance.workspace.title')}
                </Text>
              </Flexbox>
              <button
                aria-label={t('workspace.collapse')}
                className={styles.collapseBtn}
                title={t('workspace.collapse')}
                type={'button'}
                onClick={() => setExpand(false)}
              >
                <Icon icon={PanelLeftClose} size={16} />
              </button>
            </div>
            <div className={styles.searchRow}>
              <label className={styles.search}>
                <Icon icon={Search} size={13} />
                <input
                  placeholder={t('workspace.search')}
                  type={'search'}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <DropdownMenu items={filterItems} placement={'bottomRight'}>
                <ActionIcon
                  active={filter !== 'all'}
                  className={styles.filterButton}
                  icon={ListFilter}
                  size={'small'}
                  title={t('acceptance.workspace.filters.title')}
                />
              </DropdownMenu>
              {!showGroups && renderProjectActions?.()}
            </div>
          </div>

          <Flexbox flex={1} style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }}>
            {error ? (
              // A failed fetch must read as an error with a retry — never as an
              // empty "no acceptances" page.
              <Center className={styles.emptyState} gap={12}>
                <Empty
                  description={t('workspace.loadError')}
                  icon={TriangleAlert}
                  title={t('workspace.loadErrorTitle')}
                />
                <button className={styles.retryBtn} type={'button'} onClick={() => void mutate()}>
                  {t('workspace.retry')}
                </button>
              </Center>
            ) : isLoading ? (
              <SkeletonList rows={6} style={{ paddingBlock: 6, paddingInline: 8 }} />
            ) : filtered.length === 0 ? (
              trimmedQuery || filter !== 'all' ? (
                // A zero-result FILTER must read as "no match for this query",
                // never as the first-run empty state.
                <div className={styles.searchEmpty}>
                  <span className={styles.searchEmptyMsg}>
                    {trimmedQuery
                      ? t('acceptance.workspace.filters.noSearchResults', { query: trimmedQuery })
                      : filter === 'all'
                        ? null
                        : t(EMPTY_FILTER_KEYS[filter])}
                  </span>
                  <button
                    className={styles.retryBtn}
                    type={'button'}
                    onClick={() => {
                      setQuery('');
                      setStoredFilter('all');
                    }}
                  >
                    {t('acceptance.workspace.filters.showAll')}
                  </button>
                </div>
              ) : (
                <Center className={styles.emptyState}>
                  <Empty
                    description={t('acceptance.workspace.listEmpty')}
                    icon={ScrollText}
                    title={t('acceptance.workspace.listEmptyTitle')}
                  />
                </Center>
              )
            ) : (
              <div className={styles.list}>
                {showGroups ? (
                  <Accordion
                    expandedKeys={expandedAcceptanceGroupKeys(groups, collapsedGroups)}
                    gap={4}
                    onExpandedChange={(keys) =>
                      setCollapsedGroups((previous) =>
                        nextCollapsedGroupKeys(previous, groups, keys.map(String)),
                      )
                    }
                  >
                    {groups.map((group) => (
                      <AccordionItem
                        action={renderProjectActions?.(group.projectName ? group.key : undefined)}
                        itemKey={group.key}
                        key={group.key}
                        paddingBlock={4}
                        paddingInline={8}
                        title={
                          <span className={styles.groupTitle}>
                            <Icon icon={FolderClosed} size={14} />
                            <span>
                              {group.projectName ?? t('acceptance.workspace.groups.ungrouped')} ·{' '}
                              {group.items.length}
                            </span>
                          </span>
                        }
                      >
                        <div className={styles.groupList}>
                          {group.items.map((item) => (
                            <AcceptanceRow
                              active={item.id === acceptanceId}
                              item={item}
                              key={item.id}
                              onChanged={mutate}
                            />
                          ))}
                        </div>
                      </AccordionItem>
                    ))}
                  </Accordion>
                ) : (
                  filtered.map((item) => (
                    <AcceptanceRow
                      active={item.id === acceptanceId}
                      item={item}
                      key={item.id}
                      onChanged={mutate}
                    />
                  ))
                )}
              </div>
            )}
          </Flexbox>
        </DraggablePanelContainer>
      </DraggablePanel>
    );
  },
);

AcceptanceListPanel.displayName = 'AcceptanceListPanel';

export default AcceptanceListPanel;
