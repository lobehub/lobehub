'use client';

import { AGENT_CHAT_TOPIC_URL } from '@lobechat/const';
import type { InboundWebhookDeliveryItem, InboundWebhookDeliveryPage } from '@lobechat/types';
import { ActionIcon, Button, Flexbox, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { RotateCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useClientDataSWR } from '@/libs/swr';
import { inboundWebhookService } from '@/services/inboundWebhook';

import { type OlderDeliveryPages, visibleDeliveries } from './deliveryPages';

dayjs.extend(relativeTime);

export const WEBHOOK_DELIVERIES_SWR_KEY = 'agent-webhook-deliveries';

const styles = stylex.create({
  muted: { color: cssVar.colorTextTertiary },
  preview: {
    overflow: 'hidden',
    minInlineSize: 0,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    color: cssVar.colorTextSecondary,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  reason: { fontSize: '12px', color: cssVar.colorTextSecondary },
  topicLink: {
    overflow: 'hidden',
    display: 'block',
    fontSize: '12px',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorLink },
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

const STATUS_COLOR: Record<InboundWebhookDeliveryItem['status'], string | undefined> = {
  failed: 'error',
  ignored: undefined,
  pending: 'processing',
  processed: 'success',
};

/** Why a delivery did not wake the Agent, in the page's words; unknown reasons read generically. */
const KNOWN_REASONS = new Set([
  'agent_start_failed',
  'feature_disabled',
  'insufficient_budget',
  'target_removed',
  'topic_busy',
  'wake_cap',
  'webhook_paused',
  'webhook_removed',
]);

/**
 * The webhook's recent calls: when each arrived, what became of it, what it carried, and the
 * Topic it ran in. Mounted only when opened, so a page of webhooks costs one request each only
 * when asked.
 */
const DeliveryLog = memo<{ agentId: string; webhookId: string }>(({ agentId, webhookId }) => {
  const { t } = useTranslation('agent');
  const first = useClientDataSWR<InboundWebhookDeliveryPage>(
    [WEBHOOK_DELIVERIES_SWR_KEY, webhookId],
    () => inboundWebhookService.listDeliveries(webhookId),
  );
  // Older pages, appended by "Load more"; dropped when the first page moves (see visibleDeliveries).
  const [older, setOlder] = useState<OlderDeliveryPages>();
  const [loadingMore, setLoadingMore] = useState(false);
  const { items, nextCursor, older: current } = visibleDeliveries(first.data, older);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await inboundWebhookService.listDeliveries(webhookId, nextCursor);
      setOlder({
        after: first.data?.nextCursor,
        page: {
          items: [...(current?.items ?? []), ...(page.items ?? [])],
          nextCursor: page.nextCursor,
        },
      });
    } finally {
      setLoadingMore(false);
    }
  };
  const reload = () => {
    setOlder(undefined);
    void first.mutate();
  };

  const columns: LiteTableColumn<InboundWebhookDeliveryItem>[] = [
    {
      key: 'receivedAt',
      listSlot: 'title',
      render: (item) => (
        <span title={dayjs(item.receivedAt).format('YYYY-MM-DD HH:mm:ss')}>
          {dayjs(item.receivedAt).fromNow()}
        </span>
      ),
      title: t('webhook.deliveries.columns.receivedAt'),
      width: 120,
    },
    {
      key: 'status',
      render: (item) => (
        <Flexbox gap={2}>
          <Flexbox horizontal align={'center'} gap={4}>
            <Tag color={STATUS_COLOR[item.status]}>
              {t(`webhook.deliveries.status.${item.status}`)}
            </Tag>
            {item.test && <Tag>{t('webhook.deliveries.test')}</Tag>}
          </Flexbox>
          {item.reason && item.status !== 'processed' && (
            <span {...stylex.props(styles.reason)}>
              {t(
                `webhook.deliveries.reason.${KNOWN_REASONS.has(item.reason) ? item.reason : 'unknown'}` as any,
              )}
            </span>
          )}
        </Flexbox>
      ),
      title: t('webhook.deliveries.columns.status'),
      width: 180,
    },
    {
      key: 'request',
      render: (item) =>
        item.payloadPurged ? (
          <span {...stylex.props(styles.muted)}>{t('webhook.deliveries.purged')}</span>
        ) : (
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            {item.threadKey && (
              <span {...stylex.props(styles.reason)}>
                {t('webhook.deliveries.thread', { thread: item.threadKey })}
              </span>
            )}
            <span title={item.preview ?? ''} {...stylex.props(styles.preview)}>
              {item.preview}
            </span>
          </Flexbox>
        ),
      title: t('webhook.deliveries.columns.request'),
    },
    {
      key: 'topic',
      render: (item) =>
        item.topic ? (
          <WorkspaceLink
            to={AGENT_CHAT_TOPIC_URL(agentId, item.topic.id)}
            {...stylex.props(styles.topicLink)}
          >
            {item.topic.title?.trim() || t('webhook.deliveries.untitledTopic')}
          </WorkspaceLink>
        ) : (
          <span {...stylex.props(styles.muted)}>--</span>
        ),
      title: t('webhook.deliveries.columns.topic'),
      width: 180,
    },
  ];

  return (
    <Flexbox gap={8}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Text type={'secondary'}>{t('webhook.deliveries.title')}</Text>
        <ActionIcon
          icon={RotateCwIcon}
          loading={first.isValidating}
          size={'small'}
          title={t('webhook.deliveries.refresh')}
          onClick={reload}
        />
      </Flexbox>
      <AsyncBoundary
        data={first.data}
        error={first.error}
        errorVariant={'block'}
        isEmpty={items.length === 0}
        isLoading={first.isLoading}
        loading={<LiteTable loading columns={columns} rowKey={(item) => item.id} />}
        empty={
          <Text style={{ fontSize: 12, paddingBlock: 12 }} type={'secondary'}>
            {t('webhook.deliveries.empty')}
          </Text>
        }
        onRetry={reload}
      >
        <LiteTable
          columns={columns}
          dataSource={items}
          rowKey={(item) => item.id}
          tableLayout={'fixed'}
        />
        {nextCursor && (
          <Button loading={loadingMore} size={'small'} type={'text'} onClick={loadMore}>
            {t('webhook.deliveries.loadMore')}
          </Button>
        )}
      </AsyncBoundary>
    </Flexbox>
  );
});

DeliveryLog.displayName = 'AgentWebhookDeliveryLog';

export default DeliveryLog;
