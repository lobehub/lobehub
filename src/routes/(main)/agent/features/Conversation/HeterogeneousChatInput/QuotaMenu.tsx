'use client';

import type { HeteroQuotaWindow } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox, Icon, Popover, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, GaugeIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const QUOTA_STALE_MS = 60_000;

const styles = createStaticStyles(({ css }) => ({
  emptyState: css`
    padding-block: 10px;
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  error: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorErrorBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorError};

    background: ${cssVar.colorErrorBg};
  `,
  header: css`
    padding-block-end: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  popover: css`
    width: 292px;
  `,
  progressFill: css`
    height: 100%;
    border-radius: inherit;
    background: ${cssVar.colorSuccess};
  `,
  progressTrack: css`
    overflow: hidden;

    width: 100%;
    height: 6px;
    border-radius: 999px;

    background: ${cssVar.colorFillQuaternary};
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border: 0;
    border-radius: 4px;

    font: inherit;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    appearance: none;
    background: transparent;

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorTextSecondary};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  triggerOpen: css`
    color: ${cssVar.colorTextSecondary};
    background: ${cssVar.colorFillSecondary};
  `,
  value: css`
    color: ${cssVar.colorText};
  `,
  window: css`
    min-width: 0;
  `,
}));

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export interface QuotaSnapshotBase {
  error: string | null;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}

export interface QuotaWindowItem {
  key: string;
  label: string;
  window: HeteroQuotaWindow | null;
}

export interface QuotaMenuHelpers {
  formatDuration: (ms: number) => string | undefined;
  now: number;
}

interface QuotaMenuProps<S extends QuotaSnapshotBase> {
  createErrorSnapshot: (error: unknown) => S;
  fetchQuota: () => Promise<S>;
  /** Localized explanation for `status: 'unavailable'`; falls back to `error`. */
  getUnavailableText?: (quota: S) => string | undefined;
  getWindows: (quota: S) => QuotaWindowItem[];
  /** Extra agent-specific data (beyond windows) that makes the body worth rendering. */
  hasExtraData?: (quota: S) => boolean;
  renderFooter?: (quota: S, helpers: QuotaMenuHelpers) => ReactNode;
  title: string;
  tooltip: string;
}

/**
 * Shared quota popover for local CLI agents: gauge trigger with the most
 * binding window's remaining percent, plus per-window progress bars and
 * reset countdowns. Agent specifics come in through the props.
 */
const QuotaMenu = <S extends QuotaSnapshotBase>({
  createErrorSnapshot,
  fetchQuota,
  getUnavailableText,
  getWindows,
  hasExtraData,
  renderFooter,
  title,
  tooltip,
}: QuotaMenuProps<S>) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<S | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadQuota = useCallback(async () => {
    setLoading(true);

    try {
      const nextQuota = await fetchQuota();
      setQuota(nextQuota);
    } catch (error) {
      console.error('Failed to fetch agent quota:', error);
      setQuota(createErrorSnapshot(error));
    } finally {
      setLoading(false);
    }
  }, [createErrorSnapshot, fetchQuota]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), QUOTA_STALE_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const formatDuration = useCallback(
    (ms: number) => {
      if (ms <= 0) return;

      const totalMinutes = Math.floor(ms / 60_000);
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const minutes = totalMinutes % 60;
      const parts: string[] = [];

      if (days > 0) parts.push(t('heteroAgent.quota.duration.day', { count: days }));
      if (hours > 0) parts.push(t('heteroAgent.quota.duration.hour', { count: hours }));
      if (minutes > 0 && parts.length < 2) {
        parts.push(t('heteroAgent.quota.duration.minute', { count: minutes }));
      }

      return parts.slice(0, 2).join(' ') || undefined;
    },
    [t],
  );

  const formatResetCountdown = useCallback(
    (resetsAt: number | null | undefined) => {
      if (!resetsAt) return;

      const duration = formatDuration(resetsAt - now);
      return duration
        ? t('heteroAgent.quota.resetsIn', { duration })
        : t('heteroAgent.quota.resetsSoon');
    },
    [formatDuration, now, t],
  );

  const formatUpdatedAt = useCallback(
    (updatedAt: number) => {
      const duration = formatDuration(now - updatedAt);

      return duration
        ? t('heteroAgent.quota.updatedAgo', { duration })
        : t('heteroAgent.quota.updatedJustNow');
    },
    [formatDuration, now, t],
  );

  const windows = quota ? getWindows(quota) : [];
  const firstWindow = windows.find((item) => item.window)?.window;
  const compactLeftPercent = firstWindow ? clampPercent(100 - firstWindow.usedPercent) : undefined;
  const hasQuotaData = windows.some((item) => item.window) || (!!quota && !!hasExtraData?.(quota));

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);

      if (!nextOpen || loading) return;
      if (!quota || Date.now() - quota.updatedAt > QUOTA_STALE_MS) void loadQuota();
    },
    [loadQuota, loading, quota],
  );

  const renderQuotaWindow = ({ key, label, window }: QuotaWindowItem) => {
    if (!window) return null;

    const leftPercent = clampPercent(100 - window.usedPercent);
    const resetLabel = formatResetCountdown(window.resetsAt);

    return (
      <Flexbox className={styles.window} gap={4} key={key}>
        <Text strong style={{ fontSize: 12 }}>
          {label}
        </Text>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${leftPercent}%` }} />
        </div>
        <Flexbox horizontal style={{ justifyContent: 'space-between' }}>
          <Text className={styles.value} style={{ fontSize: 12 }}>
            {t('heteroAgent.quota.left', { percent: leftPercent })}
          </Text>
          {resetLabel && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {resetLabel}
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    );
  };

  const content = (
    <Flexbox className={styles.popover} gap={10}>
      <Flexbox horizontal align={'center'} className={styles.header} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text strong>{title}</Text>
          {quota?.updatedAt && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {formatUpdatedAt(quota.updatedAt)}
            </Text>
          )}
        </Flexbox>
        <Tooltip title={t('heteroAgent.quota.refresh')}>
          <ActionIcon
            disabled={loading}
            icon={RefreshCwIcon}
            size={'small'}
            onClick={() => void loadQuota()}
          />
        </Tooltip>
      </Flexbox>

      {loading && !hasQuotaData ? (
        <Flexbox gap={8}>
          <Skeleton.Button active block size="small" style={{ height: 18 }} />
          <Skeleton.Button active block size="small" style={{ height: 18 }} />
          <Skeleton.Button active block size="small" style={{ height: 18 }} />
        </Flexbox>
      ) : quota?.status === 'unavailable' ? (
        <div className={styles.emptyState}>
          {getUnavailableText?.(quota) || quota.error || t('heteroAgent.quota.unavailable')}
        </div>
      ) : quota?.status === 'error' ? (
        <div className={styles.error}>{quota.error || t('heteroAgent.quota.unavailable')}</div>
      ) : hasQuotaData ? (
        <>
          <Flexbox gap={10}>{windows.map((item) => renderQuotaWindow(item))}</Flexbox>
          {quota && renderFooter?.(quota, { formatDuration, now })}
        </>
      ) : (
        <div className={styles.emptyState}>{t('heteroAgent.quota.noData')}</div>
      )}
    </Flexbox>
  );

  const trigger = (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={tooltip}
      className={cx(styles.trigger, open && styles.triggerOpen)}
      type="button"
    >
      <Icon icon={GaugeIcon} size={14} />
      {compactLeftPercent !== undefined && (
        <span>{t('heteroAgent.quota.compactLeft', { percent: compactLeftPercent })}</span>
      )}
      <Icon icon={ChevronDownIcon} size={12} />
    </button>
  );

  return (
    <Popover
      content={content}
      open={open}
      placement="topRight"
      trigger="click"
      onOpenChange={handleOpenChange}
    >
      <div>{open ? trigger : <Tooltip title={tooltip}>{trigger}</Tooltip>}</div>
    </Popover>
  );
};

export default QuotaMenu;
