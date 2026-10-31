'use client';

import type { HeteroQuotaWindow } from '@lobechat/electron-client-ipc';
import { ActionIcon, Alert, Flexbox, Icon, Popover, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon, GaugeIcon, RefreshCwIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  agentQuotaSelectors,
  getAgentQuotaStoreState,
  useAgentQuotaStore,
} from '@/store/agentQuota';

const QUOTA_STALE_MS = 60_000;
const QUOTA_RETRY_COOLDOWN_MS = 60_000;

const styles = stylex.create({
  compactItem: { color: 'inherit' },
  // [data-quota-level='low']
  compactItemLow: { color: cssVar.colorWarningText },
  compactItems: { display: 'inline-flex', gap: '4px', alignItems: 'center' },
  compactSeparator: { color: cssVar.colorTextQuaternary },
  emptyState: { paddingBlock: '10px', fontSize: '12px', color: cssVar.colorTextDescription },
  error: {
    padding: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorErrorBorder,
    borderRadius: cssVar.borderRadius,
    fontSize: '12px',
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  header: {
    paddingBlockEnd: '6px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  popover: { width: '292px' },
  progressTrack: {
    overflow: 'hidden',
    flex: '1',
    minWidth: '24px',
    height: '6px',
    borderRadius: '999px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  resetShort: { flex: 'none', whiteSpace: 'nowrap' },
  trigger: {
    cursor: 'pointer',
    display: 'flex',
    flex: 'none',
    gap: '6px',
    alignItems: 'center',
    paddingBlock: '2px',
    paddingInline: '4px',
    borderWidth: '0',
    borderRadius: '4px',
    fontFamily: 'inherit',
    fontStyle: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    whiteSpace: 'nowrap',
    appearance: 'none',
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
    transition: 'all 0.2s',
  },
  // [data-quota-level='low'] — after triggerOpen, as the attribute rule outranked it.
  triggerLow: {
    color: { 'default': cssVar.colorWarningText, ':hover': cssVar.colorWarningText },
  },
  triggerOpen: {
    color: cssVar.colorTextSecondary,
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  value: {
    flex: 'none',
    fontVariantNumeric: 'tabular-nums',
    color: cssVar.colorText,
  },
  valueWarning: { color: cssVar.colorWarningText },
  window: { minWidth: '0' },
  // nothing to act on until reset → grey the whole row out
  windowExhausted: { opacity: 0.45 },
  windowLabel: { flex: 'none', width: '84px', color: cssVar.colorTextSecondary },
});

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
  /**
   * The live sample failed (transport / IPC) instead of reporting a state: the
   * panel treats it like an error and keeps the last good snapshot.
   */
  sampleFailed?: boolean;
  status: 'error' | 'ok' | 'unavailable';
  updatedAt: number;
}

export interface QuotaWindowItem {
  /** Windows in the same compact group collapse to their tightest remaining value. */
  compactGroup?: string;
  /** Optional scope label shown before this window's compact percentage. */
  compactLabel?: string;
  key: string;
  label: string;
  window: HeteroQuotaWindow | null;
}

interface CompactQuotaItem {
  key: string;
  label?: string;
  leftPercent: number;
}

export interface QuotaMenuHelpers<S> {
  applyQuota: (quota: S) => void;
  formatDuration: (ms: number) => string | undefined;
  now: number;
}

export interface FetchQuotaOptions<S = unknown> {
  force?: boolean;
  /**
   * Paint an intermediate snapshot (e.g. persisted DB data) immediately while
   * a slower live refresh keeps running; the promise result stays authoritative.
   */
  onInterim?: (quota: S) => void;
  /**
   * Check the live source even when the local staleness gate would skip it
   * (focus / popover revalidation). Unlike `force`, upstream snapshot caches
   * may still answer from their fresh window.
   */
  revalidate?: boolean;
}

interface QuotaMenuProps<S extends QuotaSnapshotBase> {
  /**
   * Keep `renderHeader` on screen when there are no windows to show (an
   * unavailable / failed / empty sample), for headers that carry controls the
   * user needs in exactly those states — e.g. adding or switching an account.
   */
  alwaysRenderHeader?: boolean;
  /**
   * Revalidate on this cadence while the tab is visible, so the badge stays
   * near-live without user interaction. Upstream sampler caches must keep
   * their fresh window below this for each poll to observe new data.
   */
  autoRefreshMs?: number;
  contentWidth?: number;
  createErrorSnapshot: (error: unknown) => S;
  fetchQuota: (options?: FetchQuotaOptions<S>) => Promise<S>;
  /** Localized explanation for `status: 'error'`; falls back to `error`. */
  getErrorText?: (quota: S) => string | undefined;
  /** Localized explanation for a manual refresh error when stale data is preserved. */
  getRefreshErrorText?: (quota: S) => string | undefined;
  /**
   * Localized notice for a snapshot that still renders preserved windows but
   * whose latest live refresh could not run (e.g. the network was blocked).
   */
  getStaleNotice?: (quota: S) => string | undefined;
  /** Localized explanation for `status: 'unavailable'`; falls back to `error`. */
  getUnavailableText?: (quota: S) => string | undefined;
  getWindows: (quota: S) => QuotaWindowItem[];
  /** Extra agent-specific data (beyond windows) that makes the body worth rendering. */
  hasExtraData?: (quota: S) => boolean;
  renderFooter?: (quota: S, helpers: QuotaMenuHelpers<S>) => ReactNode;
  /** Agent-specific content rendered above the quota windows (e.g. account switcher). */
  renderHeader?: (quota: S, helpers: QuotaMenuHelpers<S>) => ReactNode;
  sourceKey?: string;
  title: string;
  tooltip: string;
}

interface LoadQuotaOptions {
  manual?: boolean;
  revalidate?: boolean;
}

interface PendingQuotaError<S> {
  nextQuota: S;
  options: LoadQuotaOptions;
  requestContext?: string;
  requestId: number;
  requestSourceKey: string;
}

/**
 * Shared quota popover for local CLI agents: gauge trigger with the tightest
 * remaining percent in each compact group, plus per-window progress bars and
 * reset countdowns. Agent specifics come in through the props.
 */
const QuotaMenu = <S extends QuotaSnapshotBase>({
  autoRefreshMs,
  contentWidth,
  createErrorSnapshot,
  fetchQuota,
  getErrorText,
  getRefreshErrorText,
  getStaleNotice,
  getUnavailableText,
  getWindows,
  hasExtraData,
  renderFooter,
  renderHeader,
  alwaysRenderHeader,
  sourceKey = 'default',
  title,
  tooltip,
}: QuotaMenuProps<S>) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // The last snapshot of this source lives in the agentQuota replica: a reload
  // or a remount paints it (with its "updated N ago" line) before the sampler
  // answers, and every applied sample is written back to it.
  const useHydrateQuotaPanel = useAgentQuotaStore((s) => s.useHydrateQuotaPanel);
  const { isHydrated } = useHydrateQuotaPanel(sourceKey);
  const quota = (useAgentQuotaStore(agentQuotaSelectors.panel(sourceKey)) as S | undefined) ?? null;
  const [refreshError, setRefreshError] = useState<S | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastTransientErrorAtRef = useRef(0);
  const requestIdRef = useRef(0);
  const sourceKeyRef = useRef(sourceKey);
  const isHydratedRef = useRef(isHydrated);
  /** An error sampled before the stored snapshot hydrated, applied once it has. */
  const pendingErrorRef = useRef<PendingQuotaError<S> | null>(null);

  /** What the panel of `key` shows now, read outside render. */
  const readQuota = useCallback(
    (key: string) =>
      (agentQuotaSelectors.panel(key)(getAgentQuotaStoreState()) as S | undefined) ?? null,
    [],
  );

  const hasQuotaDataForSnapshot = useCallback(
    (snapshot: S | null) => {
      if (!snapshot) return false;

      return getWindows(snapshot).some((item) => item.window) || !!hasExtraData?.(snapshot);
    },
    [getWindows, hasExtraData],
  );

  const setQuotaSnapshot = useCallback(
    (nextQuota: S, key: string = sourceKeyRef.current, context?: string) => {
      getAgentQuotaStoreState().setQuotaPanel(key, nextQuota, context);
    },
    [],
  );

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
      requestContext?: string,
    ) => {
      if (!isCurrentRequest(requestId, requestSourceKey)) return;

      if (nextQuota.status === 'error' || nextQuota.sampleFailed) {
        lastTransientErrorAtRef.current = Date.now();

        // Writing the error before the stored snapshot hydrated would make the
        // replica ignore that snapshot and drop its stored row: hold the error
        // until hydration settles, then judge it against what was restored.
        if (!isHydratedRef.current) {
          pendingErrorRef.current = {
            nextQuota,
            options,
            requestId,
            requestContext,
            requestSourceKey,
          };
          return;
        }

        // A failed refresh keeps the last good snapshot on screen (and in storage).
        if (hasQuotaDataForSnapshot(readQuota(requestSourceKey))) {
          if (options.manual) setRefreshError(nextQuota);
          return;
        }
      } else {
        lastTransientErrorAtRef.current = 0;
      }

      setRefreshError(null);
      setQuotaSnapshot(nextQuota, requestSourceKey, requestContext);
    },
    [hasQuotaDataForSnapshot, isCurrentRequest, readQuota, setQuotaSnapshot],
  );

  const loadQuota = useCallback(
    async (options: LoadQuotaOptions = {}) => {
      const requestSourceKey = sourceKeyRef.current;
      // A sample started under one identity (or before a user-data reset) must
      // not land in another data context's replica.
      const requestContext = getAgentQuotaStoreState().getQuotaContext();
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setRefreshError(null);
      setLoading(true);

      try {
        const nextQuota = await fetchQuota({
          ...(options.manual ? { force: true } : {}),
          ...(options.revalidate ? { revalidate: true } : {}),
          onInterim: (interimQuota) => {
            // Progressive paint: show the fast (persisted) snapshot while the
            // live refresh continues; requestId still guards stale sources.
            if (!isCurrentRequest(requestId, requestSourceKey)) return;
            setQuotaSnapshot(interimQuota, requestSourceKey, requestContext);
          },
        });
        applyQuotaResult(nextQuota, options, requestId, requestSourceKey, requestContext);
      } catch (error) {
        console.error('Failed to fetch agent quota:', error);
        applyQuotaResult(
          createErrorSnapshot(error),
          options,
          requestId,
          requestSourceKey,
          requestContext,
        );
      } finally {
        if (isCurrentRequest(requestId, requestSourceKey)) {
          setLoading(false);
        }
      }
    },
    [applyQuotaResult, createErrorSnapshot, fetchQuota, isCurrentRequest, setQuotaSnapshot],
  );

  useEffect(() => {
    sourceKeyRef.current = sourceKey;
    lastTransientErrorAtRef.current = 0;
    setRefreshError(null);
  }, [sourceKey]);

  useEffect(() => {
    void loadQuota();
  }, [loadQuota, sourceKey]);

  useEffect(() => {
    isHydratedRef.current = isHydrated;
    const pending = pendingErrorRef.current;
    if (!isHydrated || !pending) return;
    pendingErrorRef.current = null;
    applyQuotaResult(
      pending.nextQuota,
      pending.options,
      pending.requestId,
      pending.requestSourceKey,
      pending.requestContext,
    );
  }, [applyQuotaResult, isHydrated]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), QUOTA_STALE_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  // Scheduled auto-refresh: quota burns down while the user just watches the
  // agent work, so poll on the configured cadence whenever the tab is visible.
  // Each tick re-checks staleness and the transient-error cooldown, and the
  // sampler-side snapshot cache still coalesces concurrent pollers.
  useEffect(() => {
    if (!autoRefreshMs) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || loading) return;

      const currentTime = Date.now();
      const recentlyFailed =
        lastTransientErrorAtRef.current > 0 &&
        currentTime - lastTransientErrorAtRef.current < QUOTA_RETRY_COOLDOWN_MS;

      if (recentlyFailed) return;
      if (quota && currentTime - quota.updatedAt < autoRefreshMs) return;

      void loadQuota({ revalidate: true });
    }, autoRefreshMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [autoRefreshMs, loadQuota, loading, quota]);

  // Revalidate when the window regains focus: the user may have burned quota
  // elsewhere (another device, a terminal CLI session) meanwhile. Upstream
  // snapshot caches (90 s fresh window + error cooldown in the sampler host)
  // keep this from hammering the rate-limited live endpoints.
  useEffect(() => {
    const revalidateOnFocus = () => {
      if (document.visibilityState === 'hidden' || loading) return;

      const currentTime = Date.now();
      const recentlyFailed =
        lastTransientErrorAtRef.current > 0 &&
        currentTime - lastTransientErrorAtRef.current < QUOTA_RETRY_COOLDOWN_MS;

      if (recentlyFailed) return;
      if (quota && currentTime - quota.updatedAt <= QUOTA_STALE_MS) return;

      void loadQuota({ revalidate: true });
    };

    window.addEventListener('focus', revalidateOnFocus);
    document.addEventListener('visibilitychange', revalidateOnFocus);

    return () => {
      window.removeEventListener('focus', revalidateOnFocus);
      document.removeEventListener('visibilitychange', revalidateOnFocus);
    };
  }, [loadQuota, loading, quota]);

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
  const compactItemsByGroup = new Map<string, CompactQuotaItem>();
  for (const item of windows) {
    if (!item.window) continue;

    const leftPercent = clampPercent(100 - item.window.usedPercent);
    const compactGroup = item.compactGroup ?? 'default';
    const existing = compactItemsByGroup.get(compactGroup);

    if (!existing || leftPercent < existing.leftPercent) {
      compactItemsByGroup.set(compactGroup, {
        key: compactGroup,
        label: item.compactLabel,
        leftPercent,
      });
    }
  }
  const compactItems = [...compactItemsByGroup.values()];
  const hasQuotaData = hasQuotaDataForSnapshot(quota);
  const manualRefreshErrorText =
    refreshError && (getRefreshErrorText?.(refreshError) || t('heteroAgent.quota.refreshFailed'));
  const staleSnapshotErrorText =
    quota?.status === 'error' && hasQuotaData
      ? getRefreshErrorText?.(quota) || t('heteroAgent.quota.refreshFailed')
      : undefined;
  const staleNoticeText = quota && hasQuotaData ? getStaleNotice?.(quota) : undefined;
  const refreshErrorText = manualRefreshErrorText || staleSnapshotErrorText || staleNoticeText;
  // An unavailable / error explanation stays readable while a retry runs;
  // swapping it for a skeleton every poll made it look like data was loading.
  const hasStatusMessage = quota?.status === 'unavailable' || quota?.status === 'error';

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);

      if (!nextOpen || loading) return;
      const currentTime = Date.now();
      const recentlyFailed =
        lastTransientErrorAtRef.current > 0 &&
        currentTime - lastTransientErrorAtRef.current < QUOTA_RETRY_COOLDOWN_MS;

      if ((!quota || currentTime - quota.updatedAt > QUOTA_STALE_MS) && !recentlyFailed) {
        void loadQuota({ revalidate: true });
      }
    },
    [loadQuota, loading, quota],
  );

  const renderQuotaWindow = ({ key, label, window }: QuotaWindowItem) => {
    if (!window) return null;

    const leftPercent = clampPercent(100 - window.usedPercent);
    const resetShort = window.resetsAt ? formatDuration(window.resetsAt - now) : undefined;
    const exhausted = leftPercent === 0;
    // Exhausted reads as "nothing to do until reset" → grey it out, not alarm-orange.
    const lowQuota = !exhausted && isLowQuota(leftPercent);

    // One compact row per window: label · bar · NN% · short reset. The bar fill
    // already reads as "remaining", so the percent stands alone without "left".
    return (
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.window, exhausted && styles.windowExhausted).className}
        gap={8}
        key={key}
      >
        <Text
          ellipsis
          className={stylex.props(styles.windowLabel).className}
          style={{ fontSize: 12 }}
        >
          {label}
        </Text>
        <div {...stylex.props(styles.progressTrack)}>
          <div
            data-quota-level={lowQuota ? 'low' : 'normal'}
            style={{ width: `${leftPercent}%` }}
          />
        </div>
        <Text
          className={stylex.props(styles.value, lowQuota && styles.valueWarning).className}
          style={{ fontSize: 12 }}
        >
          {exhausted ? t('heteroAgent.quota.exhausted') : `${leftPercent}%`}
        </Text>
        {resetShort && (
          <Text
            className={stylex.props(styles.resetShort).className}
            style={{ fontSize: 12 }}
            type="secondary"
          >
            {resetShort}
          </Text>
        )}
      </Flexbox>
    );
  };

  const content = (
    <Flexbox
      className={stylex.props(styles.popover).className}
      gap={10}
      style={{ width: contentWidth }}
    >
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.header).className}
        gap={8}
        justify={'space-between'}
      >
        <Flexbox horizontal align={'baseline'} gap={6} style={{ minWidth: 0 }}>
          <Text strong style={{ fontSize: 13 }}>
            {title}
          </Text>
          {quota?.updatedAt && (
            <Text ellipsis style={{ fontSize: 11 }} type="secondary">
              {formatUpdatedAt(quota.updatedAt)}
            </Text>
          )}
        </Flexbox>
        <Tooltip title={t('heteroAgent.quota.refresh')}>
          <ActionIcon
            disabled={loading}
            icon={RefreshCwIcon}
            size={'small'}
            spin={loading}
            onClick={() => void loadQuota({ manual: true })}
          />
        </Tooltip>
      </Flexbox>

      {loading && !hasQuotaData && !hasStatusMessage ? (
        <Flexbox gap={8}>
          <Skeleton height={18} />
          <Skeleton height={18} />
          <Skeleton height={18} />
        </Flexbox>
      ) : quota?.status === 'unavailable' ? (
        <>
          {alwaysRenderHeader && renderHeader?.(quota, { applyQuota, formatDuration, now })}
          <div {...stylex.props(styles.emptyState)}>
            {getUnavailableText?.(quota) || quota.error || t('heteroAgent.quota.unavailable')}
          </div>
        </>
      ) : quota?.status === 'error' && !hasQuotaData ? (
        <>
          {alwaysRenderHeader && renderHeader?.(quota, { applyQuota, formatDuration, now })}
          <div {...stylex.props(styles.error)}>
            {getErrorText?.(quota) || quota.error || t('heteroAgent.quota.unavailable')}
          </div>
        </>
      ) : hasQuotaData ? (
        <>
          {quota && renderHeader?.(quota, { applyQuota, formatDuration, now })}
          <Flexbox gap={10}>{windows.map((item) => renderQuotaWindow(item))}</Flexbox>
          {quota && renderFooter?.(quota, { applyQuota, formatDuration, now })}
          {refreshErrorText && (
            // Stale windows stay the subject; the notice only annotates them.
            <Alert
              showIcon
              styles={{ title: { color: cssVar.colorTextSecondary, fontSize: 12 } }}
              title={refreshErrorText}
              type={'warning'}
              variant={'plain'}
            />
          )}
        </>
      ) : (
        <>
          {alwaysRenderHeader &&
            quota &&
            renderHeader?.(quota, { applyQuota, formatDuration, now })}
          <div {...stylex.props(styles.emptyState)}>{t('heteroAgent.quota.noData')}</div>
        </>
      )}
    </Flexbox>
  );

  const triggerQuotaLevel =
    compactItems.length === 1
      ? isLowQuota(compactItems[0].leftPercent)
        ? 'low'
        : 'normal'
      : undefined;

  const trigger = (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={tooltip}
      data-quota-level={triggerQuotaLevel}
      type="button"
      {...stylex.props(
        styles.trigger,
        open && styles.triggerOpen,
        triggerQuotaLevel === 'low' && styles.triggerLow,
      )}
    >
      <Icon icon={GaugeIcon} size={14} />
      {compactItems.length > 0 && (
        <span {...stylex.props(styles.compactItems)}>
          {compactItems.map((item, index) => {
            const itemQuotaLevel =
              compactItems.length > 1
                ? isLowQuota(item.leftPercent)
                  ? 'low'
                  : 'normal'
                : undefined;
            return (
              <span key={item.key}>
                {index > 0 && (
                  <span aria-hidden {...stylex.props(styles.compactSeparator)}>
                    {' · '}
                  </span>
                )}
                <span
                  data-quota-level={itemQuotaLevel}
                  {...stylex.props(
                    styles.compactItem,
                    itemQuotaLevel === 'low' && styles.compactItemLow,
                  )}
                >
                  {item.label && `${item.label} `}
                  {item.leftPercent === 0 && !item.label
                    ? t('heteroAgent.quota.exhausted')
                    : t('heteroAgent.quota.compactLeft', { percent: item.leftPercent })}
                </span>
              </span>
            );
          })}
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
