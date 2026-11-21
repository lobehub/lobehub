'use client';

import {
  WEBHOOK_DELIVERY_POLICY,
  type WebhookDeliveryEventType,
  type WebhookEndpointItem,
} from '@lobechat/types';
import { Flexbox, Tag, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useTranslation } from 'react-i18next';

import { formatSecretHint, resolveEndpointStatus, type WebhookEndpointStatus } from '../status';

dayjs.extend(relativeTime);

const styles = stylex.create({
  code: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
  },
  description: {
    overflow: 'hidden',
    fontSize: '12px',
    color: cssVar.colorTextTertiary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  muted: { color: cssVar.colorTextTertiary },
  // Wraps, never clamps: the second half of a reason says what to do next.
  reason: {
    maxInlineSize: '28ch',
    fontSize: '12px',
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
  reasonError: { color: cssVar.colorError },
  reasonWarning: { color: cssVar.colorWarning },
  url: {
    overflow: 'hidden',
    maxInlineSize: '36ch',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    fontWeight: 500,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

/** Label of an event type, e.g. "Run completed". */
export const useEventLabel = () => {
  const { t } = useTranslation('setting');
  return (type: WebhookDeliveryEventType) => t(`webhook.event.${type}` as any) as string;
};

export const EndpointCell = ({ endpoint }: { endpoint: WebhookEndpointItem }) => (
  <Flexbox gap={2} style={{ minWidth: 0 }}>
    <span {...stylex.props(styles.url)} title={endpoint.url}>
      {endpoint.url}
    </span>
    {endpoint.description && (
      <span {...stylex.props(styles.description)} title={endpoint.description}>
        {endpoint.description}
      </span>
    )}
  </Flexbox>
);

/** A count tag; hovering lists every subscribed event by name. */
export const EventsCell = ({ events: rawEvents }: { events: WebhookEndpointItem['events'] }) => {
  const { t } = useTranslation('setting');
  const events = rawEvents ?? [];
  const label = useEventLabel();

  return (
    <Tooltip
      title={
        <Flexbox gap={2}>
          {events.map((event) => (
            <span key={event}>{label(event)}</span>
          ))}
        </Flexbox>
      }
    >
      <Tag>{t('webhook.list.eventsCount', { count: events.length })}</Tag>
    </Tooltip>
  );
};

const STATUS_COLOR: Record<WebhookEndpointStatus, string | undefined> = {
  active: 'success',
  autoDisabled: 'error',
  failing: 'warning',
  paused: undefined,
};

const STATUS_LABEL_KEY = {
  active: 'webhook.status.active',
  autoDisabled: 'webhook.status.autoDisabled',
  failing: 'webhook.status.failing',
  paused: 'webhook.status.paused',
} as const satisfies Record<WebhookEndpointStatus, string>;

/**
 * The endpoint's state as a tag. An endpoint LobeHub switched off, or one that is
 * failing on its way there, carries the reason and the way back underneath:
 * touch screens have no hover to find it.
 */
export const StatusCell = ({ endpoint }: { endpoint: WebhookEndpointItem }) => {
  const { t } = useTranslation('setting');
  const status = resolveEndpointStatus(endpoint);
  const max = WEBHOOK_DELIVERY_POLICY.disableAfterConsecutiveFailures;

  return (
    <Flexbox align={'flex-start'} gap={4}>
      <Tag color={STATUS_COLOR[status]}>
        {t(STATUS_LABEL_KEY[status], { count: endpoint.consecutiveFailures })}
      </Tag>
      {status === 'autoDisabled' && (
        <span {...stylex.props(styles.reason, styles.reasonError)}>
          {t('webhook.status.autoDisabledDesc', { count: max })}
        </span>
      )}
      {status === 'failing' && (
        <span {...stylex.props(styles.reason, styles.reasonWarning)}>
          {t('webhook.status.failingDesc', { max })}
        </span>
      )}
    </Flexbox>
  );
};

export const SecretHintCell = ({ hint }: { hint: string }) => (
  <span {...stylex.props(styles.code)}>{formatSecretHint(hint)}</span>
);

/** Relative time ("3 minutes ago"); the exact time is one hover away. */
export const TimeCell = ({ at, fallback }: { at: Date | null; fallback?: string }) => {
  if (!at) return <span {...stylex.props(styles.muted)}>{fallback ?? '--'}</span>;
  const time = dayjs(at);
  return <span title={time.format('YYYY-MM-DD HH:mm:ss')}>{time.fromNow()}</span>;
};
