'use client';

import type { AcceptanceStatus } from '@lobechat/types';
import {
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
import { confirmModal, DropdownMenu } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import {
  BadgeCheck,
  Check,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { useLocalStorageState } from '@/hooks/useLocalStorageState';
import { mutate as globalMutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import type { AcceptanceListItem } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useAcceptanceList } from '../../hooks';
import type { ReportPanelExpand } from '../../Workspace/useReportPanelExpand';
import {
  type AcceptanceListFilter,
  DEFAULT_ACCEPTANCE_LIST_FILTER,
  filterAcceptanceList,
  normalizeAcceptanceListFilter,
} from './acceptanceListFilter';

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
  titleRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
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
  spin: css`
    animation: acceptance-spin 1.1s linear infinite;

    @keyframes acceptance-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  itemSub: css`
    display: flex;
    gap: 8px;

    margin-block-start: 2px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  editRow: css`
    padding-block: 4px;
    padding-inline: 4px;
  `,
  itemTitleInput: css`
    width: 100%;
    min-width: 0;
    height: 24px;
    padding-inline: 6px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 4px;

    font-size: 13px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorBgContainer};
    outline: none;

    &:focus {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
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

type Glyph = 'awaiting' | 'bad' | 'unsure' | 'running' | 'repairing' | 'accepted';

const RUNNING_STATUSES = new Set<AcceptanceStatus>([
  'pending',
  'planned',
  'verifying',
  'repairing',
]);

const glyphOf = (status: AcceptanceStatus): Glyph => {
  // A repair round is an in-progress TASK, distinct from a neutral verify —
  // warn-coloured, matching the system's task-process cue.
  if (status === 'repairing') return 'repairing';
  if (RUNNING_STATUSES.has(status)) return 'running';
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected') return 'bad';
  if (status === 'errored') return 'unsure';
  return 'awaiting';
};

const SPINNING_GLYPHS = new Set<Glyph>(['running', 'repairing']);

// Mirrors the detail header's verdict pill: a delivered-but-undecided
// aggregate reads as "acceptance in progress", never as a green all-clear
// the user hasn't given.
const glyphMeta: Record<Glyph, { color: string; icon: typeof BadgeCheck }> = {
  accepted: { color: cssVar.colorSuccess, icon: BadgeCheck },
  awaiting: { color: cssVar.colorInfo, icon: CircleDashed },
  bad: { color: cssVar.colorError, icon: CircleX },
  repairing: { color: cssVar.colorWarning, icon: RefreshCw },
  running: { color: cssVar.colorInfo, icon: LoaderCircle },
  unsure: { color: cssVar.colorWarning, icon: CircleHelp },
};

const relativeTime = (value?: Date | string | null) => {
  if (!value) return '';
  const d = dayjs(value);
  return dayjs().diff(d, 'day') < 7 ? d.fromNow() : d.format('MMM D');
};

/**
 * One acceptance row: the status glyph + title + a hover `…` menu (rename in
 * place, override the decision status, delete). Mirrors the verify workspace's
 * ReportListItem so the two lists manage their entries the same way.
 */
const AcceptanceRow = memo<{
  active: boolean;
  item: AcceptanceListItem;
  onChanged: () => Promise<unknown> | unknown;
}>(({ active, item, onChanged }) => {
  const { t } = useTranslation(['verify', 'common']);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const isSavingRef = useRef(false);

  const glyph = glyphOf(item.status as AcceptanceStatus);
  const meta = glyphMeta[glyph];
  const title = item.subject.title || item.subjectId;
  const [draftTitle, setDraftTitle] = useState(title);

  // A rename/status/delete must not leave a stale glyph or header behind — the
  // list and the open detail both read the same aggregate.
  const refresh = () =>
    Promise.all([onChanged(), globalMutate(verifyKeys.acceptanceBundle(item.id))]);

  const startRename = () => {
    setDraftTitle(title);
    setEditing(true);
  };

  const cancelRename = () => {
    if (isSavingRef.current) return;
    setDraftTitle(title);
    setEditing(false);
  };

  const commitRename = async () => {
    if (isSavingRef.current) return;
    const next = draftTitle.trim();
    if (!next) {
      message.error(t('verify:acceptance.workspace.renameEmpty'));
      setDraftTitle(title);
      setEditing(false);
      return;
    }
    if (next === title) {
      setEditing(false);
      return;
    }
    isSavingRef.current = true;
    setMutating(true);
    try {
      await verifyService.renameAcceptance(item.id, next);
      await refresh();
      message.success(t('verify:acceptance.workspace.renameSuccess'));
      setEditing(false);
    } catch (error) {
      console.error('[acceptance:rename]', error);
      message.error(t('verify:acceptance.workspace.renameError'));
    } finally {
      isSavingRef.current = false;
      setMutating(false);
    }
  };

  const changeStatus = async (status: 'accepted' | 'delivered' | 'rejected') => {
    setMutating(true);
    try {
      await verifyService.updateAcceptanceStatus(item.id, status);
      await refresh();
      message.success(t('verify:acceptance.workspace.statusSuccess'));
    } catch (error) {
      console.error('[acceptance:status]', error);
      message.error(t('verify:acceptance.workspace.statusError'));
    } finally {
      setMutating(false);
    }
  };

  const removeAcceptance = () => {
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('verify:acceptance.workspace.deleteConfirmDescription', { title }),
      okButtonProps: { danger: true },
      okText: t('common:delete'),
      onOk: async () => {
        setMutating(true);
        try {
          await verifyService.deleteAcceptance(item.id);
          if (active) navigate('/acceptance', { replace: true });
          await onChanged();
          message.success(t('verify:acceptance.workspace.deleteSuccess'));
        } catch (error) {
          console.error('[acceptance:delete]', error);
          message.error(t('verify:acceptance.workspace.deleteError'));
        } finally {
          setMutating(false);
        }
      },
      title: t('verify:acceptance.workspace.deleteConfirmTitle'),
    });
  };

  // The status action follows the CURRENT state — an awaiting delivery can be
  // accepted; an already-decided one can be reopened; a still-running round
  // offers nothing (accept/reject need a settled round, matching the server
  // guard). Never "reopen" an acceptance that was never decided.
  const statusItems: DropdownItem[] =
    item.status === 'delivered' || item.status === 'errored'
      ? [
          {
            icon: <Icon icon={CircleCheck} />,
            key: 'accept',
            label: t('verify:acceptance.workspace.actions.markAccepted'),
            onClick: () => void changeStatus('accepted'),
          },
        ]
      : item.status === 'accepted' || item.status === 'rejected'
        ? [
            {
              icon: <Icon icon={RotateCcw} />,
              key: 'reopen',
              label: t('verify:acceptance.workspace.actions.reopen'),
              onClick: () => void changeStatus('delivered'),
            },
          ]
        : [];

  const menuItems: DropdownItem[] = [
    {
      icon: <Icon icon={Pencil} />,
      key: 'rename',
      label: t('verify:acceptance.workspace.actions.rename'),
      onClick: startRename,
    },
    ...statusItems,
    ...(statusItems.length > 0 ? [{ type: 'divider' as const }] : []),
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'delete',
      label: t('verify:acceptance.workspace.actions.delete'),
      onClick: removeAcceptance,
    },
  ];

  // Rename swaps the whole row for an inline input.
  if (editing) {
    return (
      <div className={styles.editRow}>
        <input
          autoFocus
          className={styles.itemTitleInput}
          value={draftTitle}
          onBlur={() => void commitRename()}
          onChange={(e) => setDraftTitle(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitRename();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelRename();
            }
          }}
        />
      </div>
    );
  }

  return (
    <NavItem
      active={active}
      key={item.id}
      style={mutating ? { opacity: 0.62, pointerEvents: 'none' } : undefined}
      title={title}
      titleColor={cssVar.colorText}
      actions={
        <DropdownMenu
          iconSpaceMode={'group'}
          items={menuItems}
          placement={'bottomRight'}
          popupProps={{ style: { minWidth: 160 } }}
        >
          <ActionIcon
            icon={MoreHorizontal}
            size={'small'}
            title={t('verify:acceptance.workspace.actions.more')}
          />
        </DropdownMenu>
      }
      description={
        <Flexbox horizontal className={styles.itemSub} gap={8}>
          {/* The status glyph already carries the lifecycle state, so the
              second line shows the check count instead of a redundant label. */}
          <span>
            {item.checkCount != null
              ? t('acceptance.workspace.checkCount', { count: item.checkCount })
              : t(`acceptance.status.${item.status}` as any)}
          </span>
          <span>{relativeTime(item.updatedAt ?? item.createdAt)}</span>
        </Flexbox>
      }
      icon={
        <Icon
          className={SPINNING_GLYPHS.has(glyph) ? styles.spin : undefined}
          icon={meta.icon}
          size={16}
          style={{ color: meta.color }}
        />
      }
      onClick={() => navigate(`/acceptance/${item.id}`)}
    />
  );
});

AcceptanceRow.displayName = 'AcceptanceRow';

/**
 * Master list of the caller's acceptance aggregates — the acceptance twin of
 * the verify workspace's ReportListPanel, sharing its visual language and the
 * same persisted panel-width preference so the two surfaces read as one family.
 */
const AcceptanceListPanel = memo<ReportPanelExpand>(({ expand, isNarrow, setExpand }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useParams<{ acceptanceId: string }>();

  const { data, error, isLoading, mutate } = useAcceptanceList(true);

  // Client-side filter: the list endpoint returns the caller's full recent set
  // (bounded, no pagination), so filtering the loaded rows IS filtering the set.
  const [query, setQuery] = useState('');
  const [storedFilter, setStoredFilter] = useLocalStorageState<AcceptanceListFilter>(
    ACCEPTANCE_LIST_FILTER_STORAGE_KEY,
    DEFAULT_ACCEPTANCE_LIST_FILTER,
  );
  const filter = normalizeAcceptanceListFilter(storedFilter);
  const filtered = filterAcceptanceList(data ?? [], filter, query);
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
        <div className={styles.head}>
          <div className={styles.titleRow}>
            <Text strong style={{ fontSize: 15 }}>
              {t('acceptance.workspace.title')}
            </Text>
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
              {filtered.map((item) => (
                <AcceptanceRow
                  active={item.id === acceptanceId}
                  item={item}
                  key={item.id}
                  onChanged={mutate}
                />
              ))}
            </div>
          )}
        </Flexbox>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

AcceptanceListPanel.displayName = 'AcceptanceListPanel';

export default AcceptanceListPanel;
