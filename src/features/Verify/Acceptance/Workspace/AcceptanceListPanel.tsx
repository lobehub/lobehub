'use client';

import type { AcceptanceStatus } from '@lobechat/types';
import {
  Center,
  DraggablePanel,
  DraggablePanelContainer,
  type DraggablePanelProps,
  Empty,
  Flexbox,
  Icon,
  Text,
} from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import dayjs from 'dayjs';
import isEqual from 'fast-deep-equal';
import {
  BadgeCheck,
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  PanelLeftClose,
  ScrollText,
  TriangleAlert,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { SkeletonList } from '@/features/NavPanel/components/SkeletonList';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

import { useAcceptanceList } from '../../hooks';
import type { ReportPanelExpand } from '../../Workspace/useReportPanelExpand';

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

type Glyph = 'ok' | 'bad' | 'unsure' | 'running' | 'accepted';

const RUNNING_STATUSES = new Set<AcceptanceStatus>([
  'pending',
  'planned',
  'verifying',
  'repairing',
]);

const glyphOf = (status: AcceptanceStatus): Glyph => {
  if (RUNNING_STATUSES.has(status)) return 'running';
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected') return 'bad';
  if (status === 'errored') return 'unsure';
  return 'ok';
};

const glyphMeta: Record<Glyph, { color: string; icon: typeof CircleCheck }> = {
  accepted: { color: cssVar.colorSuccess, icon: BadgeCheck },
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

/**
 * Master list of the caller's acceptance aggregates — the acceptance twin of
 * the verify workspace's ReportListPanel, sharing its visual language and the
 * same persisted panel-width preference so the two surfaces read as one family.
 */
const AcceptanceListPanel = memo<ReportPanelExpand>(({ expand, isNarrow, setExpand }) => {
  const { t } = useTranslation('verify');
  const navigate = useNavigate();
  const { acceptanceId } = useParams<{ acceptanceId: string }>();

  const { data, error, isLoading, mutate } = useAcceptanceList(true);

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
          ) : !data || data.length === 0 ? (
            <Center className={styles.emptyState}>
              <Empty
                description={t('acceptance.workspace.listEmpty')}
                icon={ScrollText}
                title={t('acceptance.workspace.listEmptyTitle')}
              />
            </Center>
          ) : (
            <div className={styles.list}>
              {data.map((item) => {
                const glyph = glyphOf(item.status as AcceptanceStatus);
                const meta = glyphMeta[glyph];
                const title = item.subject.title || item.subjectId;

                return (
                  <NavItem
                    active={item.id === acceptanceId}
                    key={item.id}
                    title={title}
                    titleColor={cssVar.colorText}
                    description={
                      <Flexbox horizontal className={styles.itemSub} gap={8}>
                        <span>{t(`acceptance.status.${item.status}` as any)}</span>
                        <span>{relativeTime(item.updatedAt ?? item.createdAt)}</span>
                      </Flexbox>
                    }
                    icon={
                      <Icon
                        className={glyph === 'running' ? styles.spin : undefined}
                        icon={meta.icon}
                        size={16}
                        style={{ color: meta.color }}
                      />
                    }
                    onClick={() => navigate(`/acceptance/${item.id}`)}
                  />
                );
              })}
            </div>
          )}
        </Flexbox>
      </DraggablePanelContainer>
    </DraggablePanel>
  );
});

AcceptanceListPanel.displayName = 'AcceptanceListPanel';

export default AcceptanceListPanel;
