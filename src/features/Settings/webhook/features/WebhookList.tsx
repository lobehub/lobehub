'use client';

import { type WebhookEndpointItem } from '@lobechat/types';
import { Button, Empty, Flexbox, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import LiteTable, { type LiteTableColumn } from '@/components/LiteTable';
import { developerWebhookSelectors, useDeveloperWebhookStore } from '@/store/developerWebhook';

import { EndpointCell, EventsCell, SecretHintCell, StatusCell, TimeCell } from './cells';
import { DeliveriesDrawer } from './DeliveriesDrawer';
import { RowActions } from './RowActions';
import { useWebhookActions } from './useWebhookActions';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    paddingBlock: '16px',
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  header: {
    display: 'flex',
    gap: '16px',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBlockEnd: '16px',
    paddingInline: '24px',
  },
});

export const WebhookList = () => {
  const { t } = useTranslation('setting');
  const actions = useWebhookActions();
  const useFetchWebhookList = useDeveloperWebhookStore((s) => s.useFetchWebhookList);
  const { error, isValidating, revalidate } = useFetchWebhookList();
  const endpoints = useDeveloperWebhookStore(developerWebhookSelectors.endpointList);

  // The drawer holds only the id; the row is re-read so edits show through.
  const [deliveriesId, setDeliveriesId] = useState<string>();
  const deliveriesEndpoint = deliveriesId
    ? endpoints?.find((endpoint) => endpoint.id === deliveriesId)
    : undefined;

  const isEmpty = endpoints?.length === 0;

  const columns: LiteTableColumn<WebhookEndpointItem>[] = [
    {
      key: 'endpoint',
      listSlot: 'title',
      render: (endpoint) => <EndpointCell endpoint={endpoint} />,
      title: t('webhook.list.columns.endpoint'),
    },
    {
      key: 'events',
      render: (endpoint) => <EventsCell events={endpoint.events} />,
      title: t('webhook.list.columns.events'),
      width: 100,
    },
    {
      key: 'status',
      render: (endpoint) => <StatusCell endpoint={endpoint} />,
      title: t('webhook.list.columns.status'),
      width: 200,
    },
    {
      key: 'secret',
      render: (endpoint) => <SecretHintCell hint={endpoint.secretHint} />,
      title: t('webhook.list.columns.secret'),
      width: 110,
    },
    {
      key: 'lastDelivery',
      render: (endpoint) => (
        <TimeCell at={endpoint.lastDeliveryAt} fallback={t('webhook.list.never')} />
      ),
      title: t('webhook.list.columns.lastDelivery'),
      width: 120,
    },
    {
      key: 'enabled',
      render: (endpoint) => (
        <Switch
          aria-label={t('webhook.list.columns.enabled')}
          checked={endpoint.enabled}
          size={'small'}
          onChange={(enabled) => void actions.setEnabled(endpoint, enabled)}
        />
      ),
      title: t('webhook.list.columns.enabled'),
      width: 64,
    },
    {
      key: 'actions',
      listSlot: 'extra',
      render: (endpoint) => (
        <RowActions
          actions={actions}
          endpoint={endpoint}
          onOpenDeliveries={() => setDeliveriesId(endpoint.id)}
        />
      ),
      title: '',
      width: 96,
    },
  ];

  const renderBody = () => {
    if (error && !endpoints)
      return (
        <AsyncError
          error={error}
          retrying={isValidating}
          variant={'block'}
          onRetry={() => void revalidate()}
        />
      );

    return (
      <LiteTable
        columns={columns}
        dataSource={endpoints}
        listBreakpoint={800}
        loading={!endpoints}
        rowKey={(endpoint) => endpoint.id}
        emptyText={
          // The empty state owns the page's one primary action meanwhile.
          <Empty
            description={t('webhook.list.empty.desc')}
            descriptionProps={{ style: { maxWidth: '48ch' } }}
            icon={WebhookIcon}
            style={{ paddingBlock: 48 }}
            title={t('webhook.list.empty.title')}
            action={
              <Button icon={PlusIcon} type={'primary'} onClick={actions.create}>
                {t('webhook.list.actions.create')}
              </Button>
            }
          />
        }
      />
    );
  };

  return (
    <div {...stylex.props(styles.container)}>
      <div {...stylex.props(styles.header)}>
        <Flexbox gap={4}>
          <Text as={'h3'} style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
            {t('webhook.list.title')}
          </Text>
          <Text style={{ fontSize: 13 }} type={'secondary'}>
            {t('webhook.list.desc')}
          </Text>
        </Flexbox>
        {!isEmpty && (
          <Button disabled={!endpoints} icon={PlusIcon} type={'primary'} onClick={actions.create}>
            {t('webhook.list.actions.create')}
          </Button>
        )}
      </div>
      {renderBody()}
      <DeliveriesDrawer endpoint={deliveriesEndpoint} onClose={() => setDeliveriesId(undefined)} />
    </div>
  );
};
