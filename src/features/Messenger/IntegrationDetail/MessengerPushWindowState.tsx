'use client';

import { Flexbox, Icon, Skeleton, Tag, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle2Icon, ClockIcon, MoonIcon, RefreshCwIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { messengerService } from '@/services/messenger';

export type MessengerPushWindowSnapshot = Awaited<
  ReturnType<typeof messengerService.getMessengerPushWindow>
>;

const styles = createStaticStyles(({ css, cssVar }) => ({
  quotaText: css`
    font-size: 13px;
    color: ${cssVar.colorText};
    white-space: nowrap;

    > span {
      color: ${cssVar.colorTextSecondary};
    }
  `,
  statBar: css`
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: ${cssVar.colorFillSecondary};

    &[data-filled='true'] {
      background: ${cssVar.colorInfo};
    }
  `,
}));

/** Discrete best-effort quota meter: one bar per locally tracked send. */
const QuotaBars = memo<{ remaining: number; total: number }>(({ remaining, total }) => (
  <Flexbox horizontal align="center" gap={3}>
    {Array.from({ length: total }, (_, index) => (
      <div className={styles.statBar} data-filled={index < remaining} key={index} />
    ))}
  </Flexbox>
));
QuotaBars.displayName = 'MessengerPushQuotaBars';

interface MessengerPushWindowStateProps {
  /** Truthy when the status fetch failed — renders a retry affordance instead. */
  error?: unknown;
  /** Platform display name, interpolated into the hint copy. */
  name: string;
  onRetry: () => void;
  /** Undefined while loading. */
  status?: MessengerPushWindowSnapshot;
}

/**
 * The proactive-push send-window status line for one messenger platform.
 *
 * Use when:
 * - A surface has to tell the user whether the bot can reach them right now —
 *   the messenger integration detail, and the notification settings for the
 *   same platform. Both must read identically, so they share this component.
 *
 * Expects:
 * - A `getMessengerPushWindow` result for the platform, plus a way to refetch.
 *
 * Renders one of four states: fetch failure, loading, always-deliverable
 * (Telegram / Slack / Discord), or windowed (WeChat) — the last splitting
 * further into a closed window with the "message the bot" hint, and an open
 * one with its expiry and remaining quota.
 */
export const MessengerPushWindowState = memo<MessengerPushWindowStateProps>(
  ({ error, name, onRetry, status }) => {
    const { t } = useTranslation('messenger');

    if (error)
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Text type="secondary">{t('messenger.push.loadFailed')}</Text>
          <Button icon={<Icon icon={RefreshCwIcon} />} size="small" onClick={onRetry}>
            {t('messenger.push.retry')}
          </Button>
        </Flexbox>
      );

    if (!status) return <Skeleton.Button active size="small" style={{ width: 220 }} />;

    if (status.deliverability === 'always')
      return (
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
            {t('messenger.push.alwaysAvailable')}
          </Tag>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('messenger.push.alwaysAvailableHint', { platform: name })}
          </Text>
        </Flexbox>
      );

    if (!status.windowOpen)
      return (
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <Tag icon={<Icon icon={MoonIcon} size="small" />}>{t('messenger.push.windowClosed')}</Tag>
          <Text style={{ fontSize: 13 }} type="secondary">
            {t('messenger.push.windowClosedHint', { platform: name })}
          </Text>
        </Flexbox>
      );

    const expiryValue =
      status.expiresInSeconds === null
        ? null
        : status.expiresInSeconds >= 3600
          ? `~${Math.round(status.expiresInSeconds / 3600)}h`
          : `~${Math.max(1, Math.round(status.expiresInSeconds / 60))}m`;

    return (
      <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
        <Flexbox horizontal align="center" gap={8}>
          <Tag color="success" icon={<Icon icon={CheckCircle2Icon} size="small" />}>
            {t('messenger.push.windowOpen')}
          </Tag>
          {expiryValue && (
            <Tag icon={<Icon icon={ClockIcon} size="small" />}>
              {t('messenger.push.expiresIn', { value: expiryValue })}
            </Tag>
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={8}>
          <QuotaBars remaining={status.remaining} total={status.maxSends} />
          <span className={styles.quotaText}>
            {status.remaining}
            <span> / {status.maxSends}</span>
          </span>
        </Flexbox>
      </Flexbox>
    );
  },
);

MessengerPushWindowState.displayName = 'MessengerPushWindowState';
