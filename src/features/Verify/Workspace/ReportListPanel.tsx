'use client';

import type { VerifyRunStatus, VerifyVerdict } from '@lobechat/types';
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
  CircleCheck,
  CircleHelp,
  CircleX,
  ClipboardCheck,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { mutate } from '@/libs/swr';
import { verifyKeys } from '@/libs/swr/keys';
import type { VerifyReportSummary } from '@/services/verify';
import { verifyService } from '@/services/verify';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useVerifyReportSummariesInfinite } from '../hooks';
import type { ReportPanelExpand } from './useReportPanelExpand';

const PANEL_MIN = 260;
const PANEL_MAX = 420;

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
    margin-block: 8px 4px;
    margin-inline: 4px;
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
  list: css`
    display: flex;
    flex-direction: column;
    gap: 2px;

    padding-block: 6px 16px;
    padding-inline: 8px;
  `,
  editRow: css`
    padding-block: 4px;
    padding-inline: 4px;
  `,
  spin: css`
    animation: verify-spin 1.1s linear infinite;

    @keyframes verify-spin {
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
  counts: css`
    font-variant-numeric: tabular-nums;

    em {
      font-style: normal;
      color: ${cssVar.colorError};
    }
  `,
  empty: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;

    padding-block: 24px;
    padding-inline: 12px;
  `,
  emptyState: css`
    height: 100%;
    min-height: 240px;
    padding-block: 24px;
    padding-inline: 16px;
  `,
  emptyMsg: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
    word-break: break-word;
  `,
  queryHl: css`
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
    word-break: break-all;
  `,
  clearBtn: css`
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
  loadMoreError: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    justify-content: center;

    padding-block: 10px;
    padding-inline: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

type Glyph = 'ok' | 'bad' | 'unsure' | 'running';

const runningStatuses = new Set<VerifyRunStatus>(['planned', 'repairing', 'verifying']);

const glyphOf = (
  status: VerifyRunStatus | null,
  verdict: VerifyVerdict | null | undefined,
): Glyph => {
  if (status && runningStatuses.has(status)) return 'running';
  if (verdict === 'passed' || status === 'passed' || status === 'delivered') return 'ok';
  if (verdict === 'failed' || status === 'failed') return 'bad';
  return 'unsure';
};

const glyphMeta: Record<Glyph, { color: string; icon: typeof CircleCheck }> = {
  bad: { color: cssVar.colorError, icon: CircleX },
  ok: { color: cssVar.colorSuccess, icon: CircleCheck },
  running: { color: cssVar.colorInfo, icon: LoaderCircle },
  unsure: { color: cssVar.colorWarning, icon: CircleHelp },
};

const relativeTime = (value?: Date | string | null) => {
  if (!value) return '';
  const d = dayjs(value);
  return dayjs().diff(d, 'day') < 7 ? d.fromNow() : d.format('MMM D');
};

const ReportListItem = memo<{
  active: boolean;
  item: VerifyReportSummary;
  onReportsChanged: () => Promise<unknown> | unknown;
}>(({ active, item, onReportsChanged }) => {
  const { t } = useTranslation(['verify', 'common']);
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(item.run.title || '');
  const [mutating, setMutating] = useState(false);
  const isSavingRef = useRef(false);

  const status = item.run.status ?? null;
  const glyph = glyphOf(status, item.report?.verdict);
  const meta = glyphMeta[glyph];

  const planCount = Array.isArray(item.run.plan) ? item.run.plan.length : 0;
  const total = item.report?.totalChecks ?? planCount;
  const passed = item.report?.passedChecks ?? 0;
  const failed = item.report?.failedChecks ?? 0;
  const title = item.run.title || t('verify:reports.untitled');
  const time =
    glyph === 'running'
      ? t('verify:list.running')
      : relativeTime(item.report?.generatedAt ?? item.run.createdAt);

  const refreshRelatedReports = async () => {
    await Promise.all([onReportsChanged(), mutate(verifyKeys.reportBundle(item.run.id))]);
  };

  const startRename = () => {
    setDraftTitle(title);
    setEditing(true);
  };

  const cancelRename = () => {
    if (isSavingRef.current) return;
    setDraftTitle(item.run.title || '');
    setEditing(false);
  };

  const commitRename = async () => {
    if (isSavingRef.current) return;

    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      message.error(t('verify:workspace.renameEmpty'));
      setDraftTitle(item.run.title || '');
      setEditing(false);
      return;
    }

    if (nextTitle === title) {
      setEditing(false);
      return;
    }

    isSavingRef.current = true;
    setMutating(true);
    try {
      await verifyService.updateRunTitle(item.run.id, nextTitle);
      await refreshRelatedReports();
      message.success(t('verify:workspace.renameSuccess'));
      setEditing(false);
    } catch (error) {
      console.error('[verify:renameReport]', error);
      message.error(t('verify:workspace.renameError'));
    } finally {
      isSavingRef.current = false;
      setMutating(false);
    }
  };

  const deleteReport = () => {
    confirmModal({
      cancelText: t('common:cancel'),
      content: t('verify:workspace.deleteConfirmDescription', { title }),
      okButtonProps: { danger: true },
      okText: t('common:delete'),
      onOk: async () => {
        setMutating(true);
        try {
          await verifyService.deleteRun(item.run.id);
          if (active) navigate('/verify', { replace: true });
          await Promise.all([
            onReportsChanged(),
            mutate(verifyKeys.reportBundle(item.run.id), null, { revalidate: false }),
          ]);
          message.success(t('verify:workspace.deleteSuccess'));
        } catch (error) {
          console.error('[verify:deleteReport]', error);
          message.error(t('verify:workspace.deleteError'));
        } finally {
          setMutating(false);
        }
      },
      title: t('verify:workspace.deleteConfirmTitle'),
    });
  };

  const menuItems: DropdownItem[] = [
    {
      icon: <Icon icon={Pencil} />,
      key: 'rename',
      label: t('verify:workspace.actions.rename'),
      onClick: startRename,
    },
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'delete',
      label: t('verify:workspace.actions.delete'),
      onClick: deleteReport,
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

  const description =
    time || (total > 0 && glyph !== 'running') ? (
      <Flexbox horizontal className={styles.itemSub} gap={8}>
        {time ? <span>{time}</span> : null}
        {total > 0 && glyph !== 'running' ? (
          <span className={styles.counts}>
            {passed}/{total}
            {failed > 0 ? (
              <>
                {' · '}
                <em>{t('verify:list.failedCount', { count: failed })}</em>
              </>
            ) : null}
          </span>
        ) : null}
      </Flexbox>
    ) : undefined;

  return (
    <NavItem
      active={active}
      description={description}
      style={mutating ? { opacity: 0.62, pointerEvents: 'none' } : undefined}
      title={title}
      titleColor={cssVar.colorText}
      actions={
        <DropdownMenu
          iconSpaceMode={'group'}
          items={menuItems}
          placement={'bottomRight'}
          popupProps={{ style: { minWidth: 140 } }}
        >
          <ActionIcon
            icon={MoreHorizontal}
            size={'small'}
            title={t('verify:workspace.actions.more')}
          />
        </DropdownMenu>
      }
      icon={
        <Icon
          className={glyph === 'running' ? styles.spin : undefined}
          icon={meta.icon}
          size={16}
          style={{ color: meta.color }}
        />
      }
      onClick={() => navigate(`/verify/${item.run.id}`)}
    />
  );
});

ReportListItem.displayName = 'ReportListItem';

const ReportListPanel = memo<ReportPanelExpand>(({ expand, isNarrow, setExpand }) => {
  const { t } = useTranslation('verify');
  const { runId } = useParams<{ runId: string }>();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Debounce the server-side search so each keystroke doesn't fire a query.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { items, error, hasMore, isLoadingInitial, isLoadingMore, loadMore, reload } =
    useVerifyReportSummariesInfinite(debouncedQuery);

  const [panelWidth, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.verifyReportPanelWidth(s),
    s.updateSystemStatus,
  ]);
  const [tmpWidth, setTmpWidth] = useState(panelWidth);
  if (tmpWidth !== panelWidth) setTmpWidth(panelWidth);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!w || isEqual(w, panelWidth)) return;
    setTmpWidth(w);
    updateSystemStatus({ verifyReportPanelWidth: w });
  };

  // Infinite scroll: load the next page when a sentinel near the list's end
  // scrolls into view (rootMargin pre-fetches before the user hits the bottom).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoadingMore) loadMore();
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isLoadingMore, loadMore]);

  return (
    <DraggablePanel
      className={styles.panel}
      defaultSize={{ width: tmpWidth }}
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
              {t('workspace.title')}
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
          <label className={styles.search}>
            <Icon icon={Search} size={13} />
            <input
              placeholder={t('workspace.search')}
              type={'search'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        <Flexbox flex={1} style={{ minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }}>
          {error && items.length === 0 ? (
            // A failed fetch must read as an error with a retry — not masquerade
            // as an empty "no reports" page.
            <Center className={styles.emptyState} gap={12}>
              <Empty
                description={t('workspace.loadError')}
                icon={TriangleAlert}
                title={t('workspace.loadErrorTitle')}
              />
              <button className={styles.clearBtn} type={'button'} onClick={() => reload()}>
                {t('workspace.retry')}
              </button>
            </Center>
          ) : isLoadingInitial ? (
            <SkeletonList rows={6} style={{ paddingBlock: 6, paddingInline: 8 }} />
          ) : items.length === 0 ? (
            debouncedQuery ? (
              <div className={styles.empty}>
                <span className={styles.emptyMsg}>
                  {t('workspace.searchEmptyPrefix')}
                  <b className={styles.queryHl}>{debouncedQuery}</b>
                  {t('workspace.searchEmptySuffix')}
                </span>
                <button className={styles.clearBtn} type={'button'} onClick={() => setQuery('')}>
                  {t('workspace.clearSearch')}
                </button>
              </div>
            ) : (
              <Center className={styles.emptyState}>
                <Empty
                  description={t('workspace.listEmpty')}
                  icon={ClipboardCheck}
                  title={t('workspace.listEmptyTitle')}
                />
              </Center>
            )
          ) : (
            <div className={styles.list}>
              {items.map((item) => (
                <ReportListItem
                  active={item.run.id === runId}
                  item={item}
                  key={item.run.id}
                  onReportsChanged={reload}
                />
              ))}
              {/* Sentinel drives infinite scroll; keep it mounted so the observer
                  can re-fire after each page appends. */}
              <div aria-hidden ref={sentinelRef} style={{ height: 1 }} />
              {isLoadingMore ? (
                <SkeletonList rows={2} style={{ paddingBlock: 6, paddingInline: 8 }} />
              ) : error ? (
                // A later page failed (page 1 already rendered above): offer an
                // inline retry instead of a silently stuck bottom skeleton.
                <div className={styles.loadMoreError}>
                  <span>{t('workspace.loadMoreError')}</span>
                  <button className={styles.clearBtn} type={'button'} onClick={() => reload()}>
                    {t('workspace.retry')}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </Flexbox>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

ReportListPanel.displayName = 'ReportListPanel';

export default ReportListPanel;
