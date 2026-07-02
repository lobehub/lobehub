'use client';

import type { CodexQuotaSnapshot, CodexQuotaWindow } from '@lobechat/electron-client-ipc';
import { ActionIcon, Flexbox, Icon, Popover, Skeleton, Text, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { ChevronDownIcon, GaugeIcon, RefreshCwIcon, RotateCcwIcon } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { heterogeneousAgentService } from '@/services/electron/heterogeneousAgent';

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
  resetCredits: css`
    padding-block-start: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
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
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillSecondary};
    }
  `,
  triggerOpen: css`
    color: ${cssVar.colorText};
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

const createErrorSnapshot = (error: unknown): CodexQuotaSnapshot => ({
  error: error instanceof Error ? error.message : String(error),
  provider: 'codex',
  rateLimitResetCredits: null,
  session: null,
  status: 'error',
  updatedAt: Date.now(),
  weekly: null,
});

interface CodexQuotaMenuProps {
  command?: string;
  env?: Record<string, string>;
}

const CodexQuotaMenu = memo<CodexQuotaMenuProps>(({ command, env }) => {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<CodexQuotaSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadQuota = useCallback(async () => {
    setLoading(true);

    try {
      const nextQuota = await heterogeneousAgentService.getCodexQuota({ command, env });
      setQuota(nextQuota);
    } catch (error) {
      console.error('Failed to fetch Codex quota:', error);
      setQuota(createErrorSnapshot(error));
    } finally {
      setLoading(false);
    }
  }, [command, env]);

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

      if (days > 0) parts.push(t('heteroAgent.codexQuota.duration.day', { count: days }));
      if (hours > 0) parts.push(t('heteroAgent.codexQuota.duration.hour', { count: hours }));
      if (minutes > 0 && parts.length < 2) {
        parts.push(t('heteroAgent.codexQuota.duration.minute', { count: minutes }));
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
        ? t('heteroAgent.codexQuota.resetsIn', { duration })
        : t('heteroAgent.codexQuota.resetsSoon');
    },
    [formatDuration, now, t],
  );

  const formatUpdatedAt = useCallback(
    (updatedAt: number) => {
      const duration = formatDuration(now - updatedAt);

      return duration
        ? t('heteroAgent.codexQuota.updatedAgo', { duration })
        : t('heteroAgent.codexQuota.updatedJustNow');
    },
    [formatDuration, now, t],
  );

  const sessionLeftPercent = quota?.session
    ? clampPercent(100 - quota.session.usedPercent)
    : undefined;
  const resetCreditCount = quota?.rateLimitResetCredits?.availableCount;
  const resetCreditExpiry = quota?.rateLimitResetCredits?.nextExpiresAt;
  const hasQuotaData = !!(quota?.session || quota?.weekly || quota?.rateLimitResetCredits);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);

      if (!nextOpen || loading) return;
      if (!quota || Date.now() - quota.updatedAt > QUOTA_STALE_MS) void loadQuota();
    },
    [loadQuota, loading, quota],
  );

  const renderQuotaWindow = useCallback(
    (window: CodexQuotaWindow | null, label: string) => {
      if (!window) return null;

      const leftPercent = clampPercent(100 - window.usedPercent);
      const resetLabel = formatResetCountdown(window.resetsAt);

      return (
        <Flexbox className={styles.window} gap={4} key={label}>
          <Text strong style={{ fontSize: 12 }}>
            {label}
          </Text>
          <div className={styles.progressTrack}>
            <div className={styles.progressFill} style={{ width: `${leftPercent}%` }} />
          </div>
          <Flexbox horizontal style={{ justifyContent: 'space-between' }}>
            <Text className={styles.value} style={{ fontSize: 12 }}>
              {t('heteroAgent.codexQuota.left', { percent: leftPercent })}
            </Text>
            {resetLabel && (
              <Text style={{ fontSize: 12 }} type="secondary">
                {resetLabel}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
      );
    },
    [formatResetCountdown, t],
  );

  const resetCreditExpiryLabel = useMemo(() => {
    if (!resetCreditExpiry || resetCreditCount === undefined) return;

    const duration = formatDuration(resetCreditExpiry - now);
    if (!duration) return;

    return resetCreditCount > 1
      ? t('heteroAgent.codexQuota.nextExpiresIn', { duration })
      : t('heteroAgent.codexQuota.expiresIn', { duration });
  }, [formatDuration, now, resetCreditCount, resetCreditExpiry, t]);

  const content = (
    <Flexbox className={styles.popover} gap={10}>
      <Flexbox horizontal align={'center'} className={styles.header} justify={'space-between'}>
        <Flexbox gap={2}>
          <Text strong>{t('heteroAgent.codexQuota.title')}</Text>
          {quota?.updatedAt && (
            <Text style={{ fontSize: 12 }} type="secondary">
              {formatUpdatedAt(quota.updatedAt)}
            </Text>
          )}
        </Flexbox>
        <Tooltip title={t('heteroAgent.codexQuota.refresh')}>
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
      ) : quota?.status === 'error' || quota?.status === 'unavailable' ? (
        <div className={styles.error}>{quota.error || t('heteroAgent.codexQuota.unavailable')}</div>
      ) : hasQuotaData ? (
        <>
          <Flexbox gap={10}>
            {renderQuotaWindow(quota?.session ?? null, t('heteroAgent.codexQuota.session'))}
            {renderQuotaWindow(quota?.weekly ?? null, t('heteroAgent.codexQuota.weekly'))}
          </Flexbox>
          {resetCreditCount !== undefined ? (
            <Flexbox className={styles.resetCredits} gap={4}>
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon icon={RotateCcwIcon} size={13} />
                <Text strong style={{ fontSize: 12 }}>
                  {t('heteroAgent.codexQuota.resetCredits', { count: resetCreditCount })}
                </Text>
              </Flexbox>
              {resetCreditExpiryLabel && (
                <Text style={{ fontSize: 12 }} type="secondary">
                  {resetCreditExpiryLabel}
                </Text>
              )}
            </Flexbox>
          ) : (
            <Flexbox className={styles.resetCredits} gap={4}>
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon icon={RotateCcwIcon} size={13} />
                <Text style={{ fontSize: 12 }} type="secondary">
                  {t('heteroAgent.codexQuota.resetCreditsUnavailable')}
                </Text>
              </Flexbox>
            </Flexbox>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>{t('heteroAgent.codexQuota.noData')}</div>
      )}
    </Flexbox>
  );

  const trigger = (
    <button
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={t('heteroAgent.codexQuota.tooltip')}
      className={cx(styles.trigger, open && styles.triggerOpen)}
      type="button"
    >
      <Icon icon={GaugeIcon} size={14} />
      {sessionLeftPercent !== undefined && (
        <span className={styles.value}>
          {t('heteroAgent.codexQuota.compactLeft', { percent: sessionLeftPercent })}
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
      styles={{
        content: {
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: cssVar.borderRadiusLG,
          padding: 10,
        },
      }}
      onOpenChange={handleOpenChange}
    >
      <div>
        {open ? trigger : <Tooltip title={t('heteroAgent.codexQuota.tooltip')}>{trigger}</Tooltip>}
      </div>
    </Popover>
  );
});

CodexQuotaMenu.displayName = 'CodexQuotaMenu';

export default CodexQuotaMenu;
