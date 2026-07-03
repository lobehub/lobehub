'use client';

import type { VerifyRunStatus, VerifyVerdict } from '@lobechat/types';
import { DraggablePanel, DraggablePanelContainer, type DraggablePanelProps } from '@lobehub/ui';
import { Icon, Text } from '@lobehub/ui';
import { ScrollArea } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  PanelLeftClose,
  Search,
} from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import type { VerifyReportSummary } from '@/services/verify';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useVerifyReportSummaries } from '../hooks';

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
  item: css`
    cursor: pointer;

    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    gap: 10px;
    align-items: start;

    width: 100%;
    padding-block: 9px;
    padding-inline: 10px;
    border: none;
    border-radius: ${cssVar.borderRadius};

    text-align: start;

    background: none;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &[data-active='true'] {
      background: ${cssVar.colorFillSecondary};
    }
  `,
  glyph: css`
    display: flex;
    margin-block-start: 2px;
  `,
  spin: css`
    animation: verify-spin 1.1s linear infinite;

    @keyframes verify-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  itemTitle: css`
    overflow: hidden;

    font-size: 13px;
    line-height: 1.4;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;

    &[data-active='true'] {
      font-weight: 600;
    }
  `,
  itemSub: css`
    display: flex;
    gap: 8px;

    margin-block-start: 2px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  counts: css`
    font-family: ${cssVar.fontFamilyCode};
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

const ReportListItem = memo<{ active: boolean; item: VerifyReportSummary }>(({ active, item }) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const status = item.run.status ?? null;
  const glyph = glyphOf(status, item.report?.verdict);
  const meta = glyphMeta[glyph];

  const planCount = Array.isArray(item.run.plan) ? item.run.plan.length : 0;
  const total = item.report?.totalChecks ?? planCount;
  const passed = item.report?.passedChecks ?? 0;
  const failed = item.report?.failedChecks ?? 0;
  const title = item.run.title || t('reports.untitled');
  const time =
    glyph === 'running'
      ? t('list.running')
      : relativeTime(item.report?.generatedAt ?? item.run.createdAt);

  return (
    <button
      className={styles.item}
      data-active={active}
      type={'button'}
      onClick={() => navigate(`/verify/${item.run.id}`)}
    >
      <span className={styles.glyph} style={{ color: meta.color }}>
        <Icon
          className={glyph === 'running' ? styles.spin : undefined}
          icon={meta.icon}
          size={15}
        />
      </span>
      <span style={{ minWidth: 0 }}>
        <span className={styles.itemTitle} data-active={active}>
          {title}
        </span>
        <span className={styles.itemSub}>
          {time ? <span>{time}</span> : null}
          {total > 0 && glyph !== 'running' ? (
            <span className={styles.counts}>
              {passed}/{total}
              {failed > 0 ? (
                <>
                  {' '}
                  · <em>{t('list.failedCount', { count: failed })}</em>
                </>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
});

ReportListItem.displayName = 'ReportListItem';

const ReportListPanel = memo(() => {
  const { t } = useTranslation('verify');
  const { runId } = useParams<{ runId: string }>();
  const { md = true } = useResponsive();
  const { data } = useVerifyReportSummaries();
  const reports = useMemo(() => data ?? [], [data]);

  const [query, setQuery] = useState('');

  const [showPanel, panelWidth, updateSystemStatus] = useGlobalStore((s) => [
    systemStatusSelectors.showVerifyReportPanel(s),
    systemStatusSelectors.verifyReportPanelWidth(s),
    s.updateSystemStatus,
  ]);
  const [tmpWidth, setTmpWidth] = useState(panelWidth);
  if (tmpWidth !== panelWidth) setTmpWidth(panelWidth);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => (r.run.title || '').toLowerCase().includes(q));
  }, [reports, query]);

  const handleSizeChange: DraggablePanelProps['onSizeChange'] = (_, size) => {
    if (!size) return;
    const w = typeof size.width === 'string' ? Number.parseInt(size.width) : size.width;
    if (!w || isEqual(w, panelWidth)) return;
    setTmpWidth(w);
    updateSystemStatus({ verifyReportPanelWidth: w });
  };

  return (
    <DraggablePanel
      className={styles.panel}
      defaultSize={{ width: tmpWidth }}
      expand={showPanel}
      maxWidth={PANEL_MAX}
      minWidth={PANEL_MIN}
      mode={md ? 'fixed' : 'float'}
      placement={'left'}
      size={{ height: '100%', width: panelWidth }}
      onExpandChange={(expand) => updateSystemStatus({ showVerifyReportPanel: expand })}
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
              onClick={() => updateSystemStatus({ showVerifyReportPanel: false })}
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

        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              {query.trim() ? (
                <>
                  <span className={styles.emptyMsg}>
                    {t('workspace.searchEmptyPrefix')}
                    <b className={styles.queryHl}>{query.trim()}</b>
                    {t('workspace.searchEmptySuffix')}
                  </span>
                  <button className={styles.clearBtn} type={'button'} onClick={() => setQuery('')}>
                    {t('workspace.clearSearch')}
                  </button>
                </>
              ) : (
                <span className={styles.emptyMsg}>{t('workspace.listEmpty')}</span>
              )}
            </div>
          ) : (
            <div className={styles.list}>
              {filtered.map((item) => (
                <ReportListItem active={item.run.id === runId} item={item} key={item.run.id} />
              ))}
            </div>
          )}
        </ScrollArea>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

ReportListPanel.displayName = 'ReportListPanel';

export default ReportListPanel;
