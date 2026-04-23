import { Flexbox, Text } from '@lobehub/ui';
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
  variant,
}: HeterogeneousAgentGuideStateProps) => {
  const { t, i18n } = useTranslation('chat');
  const rawErrorDetails = error?.stderr || error?.message;
  const dateLocale = i18n.resolvedLanguage || i18n.language || undefined;
  const timezoneLabel = useMemo(
    () => extractTimezoneLabel(rawErrorDetails) || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [rawErrorDetails],
  );
  const formattedResetAt = useMemo(() => {
    const resetsAt = error?.rateLimitInfo?.resetsAt;
    if (!resetsAt) return;

    try {
      return new Intl.DateTimeFormat(dateLocale, {
        hour: 'numeric',
        minute: '2-digit',
        ...(timezoneLabel ? { timeZone: timezoneLabel } : {}),
        weekday: 'short',
      }).format(new Date(resetsAt * 1000));
    } catch {
      try {
        return new Intl.DateTimeFormat(dateLocale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(resetsAt * 1000));
      } catch {
        return;
      }
    }
  }, [dateLocale, error?.rateLimitInfo?.resetsAt, timezoneLabel]);
  const rateLimitTypeLabel = useMemo(() => {
    const rateLimitType = error?.rateLimitInfo?.rateLimitType;
    if (!rateLimitType) return;

    if (rateLimitType === 'seven_day') {
      return t('cliRateLimitGuide.limitTypes.weekCycle');
    }

    return rateLimitType.replaceAll('_', ' ');
  }, [error?.rateLimitInfo?.rateLimitType, t]);
  const relativeResetText = useMemo(() => {
    const resetsAt = error?.rateLimitInfo?.resetsAt;
    if (!resetsAt) return;

    const now = Date.now();
    const diffMs = Math.max(0, resetsAt * 1000 - now);
    const totalMinutes = Math.floor(diffMs / 60_000);

    if (totalMinutes <= 0) return t('cliRateLimitGuide.relative.soon');

    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];

    if (days > 0) parts.push(t('cliRateLimitGuide.relative.day', { count: days }));
    if (hours > 0) parts.push(t('cliRateLimitGuide.relative.hour', { count: hours }));
    if (minutes > 0 && parts.length < 2) {
      parts.push(t('cliRateLimitGuide.relative.minute', { count: minutes }));
    }

    return parts.length > 0
      ? t('cliRateLimitGuide.resetInApprox', { duration: parts.slice(0, 2).join(' ') })
      : t('cliRateLimitGuide.relative.soon');
  }, [error?.rateLimitInfo?.resetsAt, t]);

  return (
    <GuideShell
      headerDescription={<Text type="secondary">{t('cliRateLimitGuide.afterReset')}</Text>}
      icon={<config.icon size={24} />}
      title={t('cliRateLimitGuide.title', { name: config.title })}
      variant={variant}
      actions={
        <GuideActions
          openSystemToolsLabel={t('cliRateLimitGuide.actions.openSystemTools')}
          onOpenSystemTools={onOpenSystemTools}
        />
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
