'use client';

import {
  type WebhookDeliveryItem,
  type WebhookDeliveryStatus,
  type WebhookEndpointItem,
} from '@lobechat/types';
import { Button, Drawer, Flexbox, Tag, Text, toast } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import { RefreshCwIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { developerWebhookSelectors, useDeveloperWebhookStore } from '@/store/developerWebhook';

import { TimeCell, useEventLabel } from './cells';

const styles = stylex.create({
  code: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px' },
  error: {
    display: '-webkit-box',
    overflow: 'hidden',
    maxInlineSize: '28ch',
    fontSize: '12px',
    color: cssVar.colorError,
    overflowWrap: 'anywhere',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
  },
  eventCode: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
  },
  muted: { color: cssVar.colorTextTertiary },
  next: { fontSize: '11px', color: cssVar.colorTextTertiary },
});

const STATUS_COLOR: Record<WebhookDeliveryStatus, string | undefined> = {
  failed: 'error',
  pending: undefined,
  retrying: 'warning',
  succeeded: 'success',
};

const RedeliverButton = ({ delivery }: { delivery: WebhookDeliveryItem }) => {
  const { t } = useTranslation(['setting', 'common']);
  const [loading, setLoading] = useState(false);

  const redeliver = async () => {
    setLoading(true);
    try {
      await useDeveloperWebhookStore.getState().redeliver(delivery.endpointId, delivery.id);
      toast.success(t('webhook.deliveries.redelivered'));
    } catch {
      toast.error(t('operationFailed', { ns: 'common' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button icon={RotateCcwIcon} loading={loading} size={'small'} type={'text'} onClick={redeliver}>
      {t('webhook.deliveries.redeliver')}
    </Button>
  );
};

const DeliveryTable = ({ endpoint }: { endpoint: WebhookEndpointItem }) => {
  const { t } = useTranslation('setting');
  const label = useEventLabel();
  const useFetchDeliveries = useDeveloperWebhookStore((s) => s.useFetchDeliveries);
  const { error, isValidating, revalidate } = useFetchDeliveries(endpoint.id);
  const deliveries = useDeveloperWebhookStore(developerWebhookSelectors.deliveryList(endpoint.id));

  const columns: LiteTableColumn<WebhookDeliveryItem>[] = [
    {
      key: 'event',
      listSlot: 'title',
      render: (delivery) => (
        <Flexbox gap={2}>
          <span>{label(delivery.eventType)}</span>
          <span {...stylex.props(styles.eventCode)}>{delivery.eventType}</span>
        </Flexbox>
      ),
      title: t('webhook.deliveries.columns.event'),
    },
    {
      key: 'status',
      render: (delivery) => (
        <Flexbox align={'flex-start'} gap={2}>
          <Tag color={STATUS_COLOR[delivery.status]}>
            {t(`webhook.deliveryStatus.${delivery.status}`)}
          </Tag>
          {delivery.status === 'retrying' && delivery.nextAttemptAt && (
            <span {...stylex.props(styles.next)}>
              {t('webhook.deliveries.nextAttempt', {
                time: dayjs(delivery.nextAttemptAt).fromNow(),
              })}
            </span>
          )}
        </Flexbox>
      ),
      title: t('webhook.deliveries.columns.status'),
      width: 110,
    },
    {
      key: 'attempts',
      render: (delivery) => <span {...stylex.props(styles.code)}>{delivery.attempts}</span>,
      title: t('webhook.deliveries.columns.attempts'),
      width: 80,
    },
    {
      key: 'response',
      render: (delivery) =>
        delivery.responseStatus === null ? (
          <span {...stylex.props(styles.muted)}>--</span>
        ) : (
          <span {...stylex.props(styles.code)}>{delivery.responseStatus}</span>
        ),
      title: t('webhook.deliveries.columns.response'),
      width: 80,
    },
    {
      key: 'duration',
      render: (delivery) =>
        delivery.durationMs === null ? (
          <span {...stylex.props(styles.muted)}>--</span>
        ) : (
          <span {...stylex.props(styles.code)}>{`${delivery.durationMs} ms`}</span>
        ),
      title: t('webhook.deliveries.columns.duration'),
      width: 90,
    },
    {
      key: 'time',
      render: (delivery) => <TimeCell at={delivery.createdAt} />,
      title: t('webhook.deliveries.columns.time'),
      width: 120,
    },
    {
      key: 'error',
      render: (delivery) =>
        delivery.error ? (
          <span {...stylex.props(styles.error)} title={delivery.error}>
            {delivery.error}
          </span>
        ) : (
          <span {...stylex.props(styles.muted)}>--</span>
        ),
      title: t('webhook.deliveries.columns.error'),
    },
    {
      key: 'actions',
      listSlot: 'actions',
      render: (delivery) => <RedeliverButton delivery={delivery} />,
      title: '',
      width: 110,
    },
  ];

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={12} justify={'space-between'}>
        <Text fontSize={13} style={{ overflowWrap: 'anywhere' }} type={'secondary'}>
          {t('webhook.deliveries.desc', { url: endpoint.url })}
        </Text>
        <Button
          icon={RefreshCwIcon}
          loading={isValidating && !!deliveries}
          size={'small'}
          onClick={() => void revalidate()}
        >
          {t('webhook.deliveries.refresh')}
        </Button>
      </Flexbox>
      {error && !deliveries ? (
        <AsyncError
          error={error}
          retrying={isValidating}
          variant={'block'}
          onRetry={() => void revalidate()}
        />
      ) : (
        <LiteTable
          columns={columns}
          dataSource={deliveries}
          listBreakpoint={800}
          loading={!deliveries}
          rowKey={(delivery) => delivery.id}
          emptyText={
            <Text style={{ paddingBlock: 48, textAlign: 'center' }} type={'secondary'}>
              {t('webhook.deliveries.empty')}
            </Text>
          }
        />
      )}
    </Flexbox>
  );
};

interface DeliveriesDrawerProps {
  endpoint?: WebhookEndpointItem;
  onClose: () => void;
}

/** The latest deliveries of one endpoint, each with its result and a Redeliver action. */
export const DeliveriesDrawer = ({ endpoint, onClose }: DeliveriesDrawerProps) => {
  const { t } = useTranslation('setting');

  return (
    <Drawer
      open={!!endpoint}
      placement={'right'}
      title={t('webhook.deliveries.title')}
      width={'min(96vw, 960px)'}
      onClose={onClose}
    >
      {endpoint && <DeliveryTable endpoint={endpoint} key={endpoint.id} />}
    </Drawer>
  );
};
