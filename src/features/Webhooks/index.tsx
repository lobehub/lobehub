'use client';

import { Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { WebhookIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import NotFound from '@/components/404';
import AsyncBoundary from '@/components/AsyncBoundary';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import { useAgentWebhooks } from '@/features/AgentWebhook/useAgentWebhooks';
import WebhookItem from '@/features/AgentWebhook/WebhookItem';
import { resolveAutomationsGate } from '@/features/Automations/gate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

const PageSkeleton = createSurfaceSkeleton('list');

/**
 * Every agent's custom webhooks in the active scope, shared by personal and workspace settings.
 * Each is managed here as on its agent's page; a webhook belongs to an agent, so creating one
 * starts from that agent (Agent Profile → Webhook).
 */
const Webhooks = () => {
  // The `agent` namespace holds the webhook card copy and loads lazily.
  const { t, ready } = useTranslation(['setting', 'agent']);
  const gate = useServerConfigStore((s) =>
    resolveAutomationsGate({
      enableWebhook: serverConfigSelectors.enableWebhook(s),
      serverConfigInit: s.serverConfigInit,
    }),
  );
  const { data, error, isLoading, reload, removeRow, replaceRow } = useAgentWebhooks();
  const rows = data ?? [];

  if (gate === 'loading' || !ready) return <PageSkeleton />;
  if (gate === 'notFound') return <NotFound />;

  return (
    <Flexbox gap={16} paddingBlock={16}>
      <Text style={{ fontSize: 13 }} type={'secondary'}>
        {t('webhooks.desc')}
      </Text>
      <AsyncBoundary
        data={data}
        error={error}
        errorVariant={'block'}
        isEmpty={rows.length === 0}
        isLoading={isLoading}
        empty={
          <Center height={240} width={'100%'}>
            <Empty
              description={t('webhooks.empty.desc')}
              descriptionProps={{ style: { maxWidth: '48ch' } }}
              icon={WebhookIcon}
              title={t('webhooks.empty.title')}
            />
          </Center>
        }
        onRetry={() => void reload()}
      >
        <Flexbox gap={12}>
          {rows.map((item) => (
            <WebhookItem
              showAgent
              agentId={item.agent?.id ?? ''}
              item={item}
              key={item.id}
              onChange={replaceRow}
              onRemoved={removeRow}
            />
          ))}
        </Flexbox>
      </AsyncBoundary>
    </Flexbox>
  );
};

export default Webhooks;
