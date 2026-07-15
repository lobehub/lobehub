'use client';

import type { HeteroQuotaWindow } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox, Icon, Popover, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, GaugeIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const QUOTA_STALE_MS = 60_000;
const QUOTA_RETRY_COOLDOWN_MS = 60_000;

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
  refreshNotice: css`
    padding: 8px;
    border: 1px solid ${cssVar.colorWarningBorder};
    border-radius: ${cssVar.borderRadius};

    font-size: 12px;
    color: ${cssVar.colorWarningText};

    background: ${cssVar.colorWarningBg};
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
  progressFillWarning: css`
    background: ${cssVar.colorWarning};
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

    &[data-quota-level='low'] {
      color: ${cssVar.colorWarningText};

      &:hover {
        color: ${cssVar.colorWarningText};
      }
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
const LOW_QUOTA_THRESHOLD = 15;

const isLowQuota = (leftPercent: number) => leftPercent < LOW_QUOTA_THRESHOLD;

type QuotaSourcePart = Record<string, string | undefined> | string | null | undefined;

const normalizeQuotaSourcePart = (part: QuotaSourcePart) => {
  if (!part || typeof part === 'string') return part ?? null;

  return Object.entries(part).sort(([left], [right]) => left.localeCompare(right));
};

export const createQuotaSourceKey = (...parts: QuotaSourcePart[]) =>
  JSON.stringify(parts.map((part) => normalizeQuotaSourcePart(part)));

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

export interface QuotaMenuHelpers<S> {
  applyQuota: (quota: S) => void;
  formatDuration: (ms: number) => string | undefined;
  now: number;
}

export interface FetchQuotaOptions {
  force?: boolean;
}

interface QuotaMenuProps<S extends QuotaSnapshotBase> {
  contentWidth?: number;
  createErrorSnapshot: (error: unknown) => S;
  fetchQuota: (options?: FetchQuotaOptions) => Promise<S>;
  /** Localized explanation for `status: 'error'`; falls back to `error`. */
  getErrorText?: (quota: S) => string | undefined;
  /** Localized explanation for a manual refresh error when stale data is preserved. */
  getRefreshErrorText?: (quota: S) => string | undefined;
  /** Localized explanation for `status: 'unavailable'`; falls back to `error`. */
  getUnavailableText?: (quota: S) => string | undefined;
  getWindows: (quota: S) => QuotaWindowItem[];
  /** Extra agent-specific data (beyond windows) that makes the body worth rendering. */
  hasExtraData?: (quota: S) => boolean;
  renderFooter?: (quota: S, helpers: QuotaMenuHelpers<S>) => ReactNode;
  sourceKey?: string;
  title: string;
  tooltip: string;
}

interface LoadQuotaOptions {
  manual?: boolean;
}

/**
 * Shared quota popover for local CLI agents: gauge trigger with the most
 * binding window's remaining percent, plus per-window progress bars and
 * reset countdowns. Agent specifics come in through the props.
 */
const QuotaMenu = <S extends QuotaSnapshotBase>({
  contentWidth,
  createErrorSnapshot,
  fetchQuota,
  getErrorText,
  getRefreshErrorText,
  getUnavailableText,
  getWindows,
  hasExtraData,
  renderFooter,
  sourceKey = 'default',
  title,
  tooltip,
}: QuotaMenuProps<S>) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<S | null>(null);
  const [refreshError, setRefreshError] = useState<S | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastTransientErrorAtRef = useRef(0);
  const quotaRef = useRef<S | null>(null);
  const requestIdRef = useRef(0);
  const sourceKeyRef = useRef(sourceKey);

  const hasQuotaDataForSnapshot = useCallback(
    (snapshot: S | null) => {
      if (!snapshot) return false;

      return getWindows(snapshot).some((item) => item.window) || !!hasExtraData?.(snapshot);
    },
    [getWindows, hasExtraData],
  );

  const setQuotaSnapshot = useCallback((nextQuota: S) => {
    quotaRef.current = nextQuota;
    setQuota(nextQuota);
  }, []);

  const applyQuota = useCallback(
    (nextQuota: S) => {
      if (sourceKeyRef.current !== sourceKey) return;

      // A completed mutation owns the newest snapshot. Invalidate any older
      // read still in flight so it cannot repaint pre-mutation quota data.
      requestIdRef.current += 1;
      setLoading(false);
      setRefreshError(null);
      setQuotaSnapshot(nextQuota);
    },
    [setQuotaSnapshot, sourceKey],
  );

  const isCurrentRequest = useCallback(
    (requestId: number, requestSourceKey: string) =>
      requestId === requestIdRef.current && requestSourceKey === sourceKeyRef.current,
    [],
  );

  const applyQuotaResult = useCallback(
    (
      nextQuota: S,
      options: LoadQuotaOptions = {},
      requestId = requestIdRef.current,
      requestSourceKey = sourceKeyRef.current,
    ) => {
      if (!isCurrentRequest(requestId, requestSourceKey)) return;

      if (nextQuota.status === 'error') {
        lastTransientErrorAtRef.current = Date.now();

        if (hasQuotaDataForSnapshot(quotaRef.current)) {
          if (options.manual) setRefreshError(nextQuota);
          return;
        }
      } else {
        lastTransientErrorAtRef.current = 0;
      }

      setRefreshError(null);
      setQuotaSnapshot(nextQuota);
    },
    [hasQuotaDataForSnapshot, isCurrentRequest, setQuotaSnapshot],
  );

  const loadQuota = useCallback(
    async (options: LoadQuotaOptions = {}) => {
      const requestSourceKey = sourceKeyRef.current;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setRefreshError(null);
      setLoading(true);

      try {
        const nextQuota = await fetchQuota(options.manual ? { force: true } : undefined);
        applyQuotaResult(nextQuota, options, requestId, requestSourceKey);
      } catch (error) {
        console.error('Failed to fetch agent quota:', error);
        applyQuotaResult(createErrorSnapshot(error), options, requestId, requestSourceKey);
      } finally {
        if (isCurrentRequest(requestId, requestSourceKey)) {
          setLoading(false);
        }
      }
    },
    [applyQuotaResult, createErrorSnapshot, fetchQuota, isCurrentRequest],
  );

  useEffect(() => {
    sourceKeyRef.current = sourceKey;
    quotaRef.current = null;
    lastTransientErrorAtRef.current = 0;
    setQuota(null);
    setRefreshError(null);
  }, [sourceKey]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota, sourceKey]);

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
  const compactLeftPercent = windows.reduce<number | undefined>((mostBinding, item) => {
    if (!item.window) return mostBinding;
    const leftPercent = clampPercent(100 - item.window.usedPercent);
    return mostBinding === undefined ? leftPercent : Math.min(mostBinding, leftPercent);
  }, undefined);
  const hasQuotaData = hasQuotaDataForSnapshot(quota);
  const manualRefreshErrorText =
    refreshError && (getRefreshErrorText?.(refreshError) || t('heteroAgent.quota.refreshFailed'));
  const staleSnapshotErrorText =
    quota?.status === 'error' && hasQuotaData
      ? getRefreshErrorText?.(quota) || t('heteroAgent.quota.refreshFailed')
      : undefined;
  const refreshErrorText = manualRefreshErrorText || staleSnapshotErrorText;

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);

      if (!nextOpen || loading) return;
      const currentTime = Date.now();
      const recentlyFailed =
        lastTransientErrorAtRef.current > 0 &&
        currentTime - lastTransientErrorAtRef.current < QUOTA_RETRY_COOLDOWN_MS;

      if ((!quota || currentTime - quota.updatedAt > QUOTA_STALE_MS) && !recentlyFailed) {
        void loadQuota();
      }
    },
    [loadQuota, loading, quota],
  );

  const renderQuotaWindow = ({ key, label, window }: QuotaWindowItem) => {
    if (!window) return null;

    const leftPercent = clampPercent(100 - window.usedPercent);
    const resetLabel = formatResetCountdown(window.resetsAt);
    const lowQuota = isLowQuota(leftPercent);

    return (
      <Flexbox className={styles.window} gap={4} key={key}>
        <Text strong style={{ fontSize: 12 }}>
          {label}
        </Text>
        <div className={styles.progressTrack}>
          <div
            className={cx(styles.progressFill, lowQuota && styles.progressFillWarning)}
            data-quota-level={lowQuota ? 'low' : 'normal'}
            style={{ width: `${leftPercent}%` }}
          />
        </div>
        <Flexbox horizontal style={{ justifyContent: 'space-between' }}>
          <Text className={styles.value} style={{ fontSize: 12 }}>
            {leftPercent === 0
              ? t('heteroAgent.quota.exhausted')
              : t('heteroAgent.quota.left', { percent: leftPercent })}
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
    <Flexbox className={styles.popover} gap={10} style={{ width: contentWidth }}>
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
            onClick={() => void loadQuota({ manual: true })}
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
      ) : quota?.status === 'error' && !hasQuotaData ? (
        <div className={styles.error}>
          {getErrorText?.(quota) || quota.error || t('heteroAgent.quota.unavailable')}
        </div>
      ) : hasQuotaData ? (
        <>
          <Flexbox gap={10}>{windows.map((item) => renderQuotaWindow(item))}</Flexbox>
          {quota && renderFooter?.(quota, { applyQuota, formatDuration, now })}
          {refreshErrorText && <div className={styles.refreshNotice}>{refreshErrorText}</div>}
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
      data-quota-level={
        compactLeftPercent === undefined
          ? undefined
          : isLowQuota(compactLeftPercent)
            ? 'low'
            : 'normal'
      }
    >
      <Icon icon={GaugeIcon} size={14} />
      {compactLeftPercent !== undefined && (
        <span>
          {compactLeftPercent === 0
            ? t('heteroAgent.quota.exhausted')
            : t('heteroAgent.quota.compactLeft', { percent: compactLeftPercent })}
        </span>
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
