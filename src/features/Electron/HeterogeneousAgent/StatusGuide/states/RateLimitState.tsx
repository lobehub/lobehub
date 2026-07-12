import { Flexbox, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { CalendarClock, Play, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import GuideActions from '../GuideActions';
import GuideShell from '../GuideShell';
import type { HeterogeneousAgentGuideStateProps } from '../types';

const extractTimezoneLabel = (value?: string) => {
  if (!value) return;

  const match = value.match(/\(([^()]+)\)\s*$/);
  return match?.[1];
};

const RateLimitState = ({
  config,
  error,
  onOpenSystemTools,
  onRetry,
  schedule,
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t, i18n } = useTranslation('chat');
  const rawErrorDetails = error?.stderr || error?.message;
  const dateLocale = i18n.resolvedLanguage || i18n.language || undefined;
  // Prefer the persisted scheduled reset time so the "已安排" copy stays stable
  // even if the live error payload is missing it on reload.
  const effectiveResetsAt = schedule?.resetsAt ?? error?.rateLimitInfo?.resetsAt;
  const timezoneLabel = useMemo(
    () => extractTimezoneLabel(rawErrorDetails) || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [rawErrorDetails],
  );
  const formattedResetAt = useMemo(() => {
    if (!effectiveResetsAt) return;

    try {
      return new Intl.DateTimeFormat(dateLocale, {
        hour: 'numeric',
        minute: '2-digit',
        ...(timezoneLabel ? { timeZone: timezoneLabel } : {}),
        weekday: 'short',
      }).format(new Date(effectiveResetsAt * 1000));
    } catch {
      try {
        return new Intl.DateTimeFormat(dateLocale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(effectiveResetsAt * 1000));
      } catch {
        return;
      }
    }
  }, [dateLocale, effectiveResetsAt, timezoneLabel]);
  const rateLimitTypeLabel = useMemo(() => {
    const rateLimitType = error?.rateLimitInfo?.rateLimitType;
    if (!rateLimitType) return;

    if (rateLimitType === 'seven_day') {
      return t('cliRateLimitGuide.limitTypes.weekCycle');
    }

    return rateLimitType.replaceAll('_', ' ');
  }, [error?.rateLimitInfo?.rateLimitType, t]);
  // The "~X h Y m" duration string, reused both for the header hint and the
  // scheduling action/label copy.
  const relativeDuration = useMemo(() => {
    if (!effectiveResetsAt) return;

    const diffMs = Math.max(0, effectiveResetsAt * 1000 - Date.now());
    const totalMinutes = Math.floor(diffMs / 60_000);
    if (totalMinutes <= 0) return;

    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) parts.push(t('cliRateLimitGuide.relative.day', { count: days }));
    if (hours > 0) parts.push(t('cliRateLimitGuide.relative.hour', { count: hours }));
    if (minutes > 0 && parts.length < 2) {
      parts.push(t('cliRateLimitGuide.relative.minute', { count: minutes }));
    }

    return parts.length > 0 ? parts.slice(0, 2).join(' ') : undefined;
  }, [effectiveResetsAt, t]);
  const relativeResetText = useMemo(() => {
    if (!effectiveResetsAt) return;
    if (!relativeDuration) return t('cliRateLimitGuide.relative.soon');
    return t('cliRateLimitGuide.resetInApprox', { duration: relativeDuration });
  }, [effectiveResetsAt, relativeDuration, t]);

  const scheduleActions = useMemo(() => {
    if (!schedule) return;

    if (schedule.isScheduled) {
      return (
        <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
          <Button size="small" onClick={schedule.onCancel}>
            {t('cliRateLimitGuide.schedule.cancel')}
          </Button>
          <Button icon={<Play size={14} />} size="small" type="primary" onClick={schedule.onRunNow}>
            {t('cliRateLimitGuide.schedule.runNow')}
          </Button>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
        {onRetry && (
          <Button icon={<RotateCcw size={14} />} size="small" onClick={onRetry}>
            {t('cliRateLimitGuide.schedule.retryNow')}
          </Button>
        )}
        <Button
          icon={<CalendarClock size={14} />}
          size="small"
          type="primary"
          onClick={schedule.onSchedule}
        >
          {relativeDuration
            ? t('cliRateLimitGuide.schedule.continueAfter', { duration: relativeDuration })
            : t('cliRateLimitGuide.schedule.continueAfterReset')}
        </Button>
      </Flexbox>
    );
  }, [onRetry, relativeDuration, schedule, t]);

  const isScheduled = Boolean(schedule?.isScheduled);

  return (
    <GuideShell
      icon={<config.icon size={24} />}
      title={t('cliRateLimitGuide.title', { name: config.title })}
      variant={variant}
      actions={
        scheduleActions ?? (
          <GuideActions
            retryLabel={t('cliRateLimitGuide.actions.retry')}
            openSystemToolsLabel={
              onRetry ? undefined : t('cliRateLimitGuide.actions.openSystemTools')
            }
            onOpenSystemTools={onRetry ? undefined : onOpenSystemTools}
            onRetry={onRetry}
          />
        )
      }
      headerDescription={
        <Text type="secondary">
          {isScheduled
            ? relativeDuration
              ? t('cliRateLimitGuide.schedule.scheduledForApprox', { duration: relativeDuration })
              : t('cliRateLimitGuide.schedule.scheduledAfterReset')
            : t('cliRateLimitGuide.afterReset', {
                resetAt: formattedResetAt
                  ? `${formattedResetAt}${timezoneLabel ? ` (${timezoneLabel})` : ''}`
                  : t('cliRateLimitGuide.resetUnknown'),
              })}
        </Text>
      }
    >
      <Flexbox gap={8}>
        {formattedResetAt && (
          <Flexbox horizontal gap={8} style={{ alignItems: 'baseline' }}>
            <Text strong style={{ fontSize: 12 }}>
              {t('cliRateLimitGuide.resetAt')}
            </Text>
            <Flexbox
              horizontal
              gap={8}
              style={{ alignItems: 'baseline', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}
            >
              <Text>{`${formattedResetAt}${timezoneLabel ? ` (${timezoneLabel})` : ''}`}</Text>
              {relativeResetText && (
                <Text style={{ fontSize: 12, whiteSpace: 'nowrap' }} type="secondary">
                  {relativeResetText}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        )}

        {rateLimitTypeLabel && (
          <Flexbox horizontal align="center" gap={8}>
            <Text strong style={{ fontSize: 12 }}>
              {t('cliRateLimitGuide.limitType')}
            </Text>
            <Text>{rateLimitTypeLabel}</Text>
          </Flexbox>
        )}
      </Flexbox>
    </GuideShell>
  );
};

export default RateLimitState;
