'use client';

import { Button, Center, Empty, Flexbox, Text } from '@lobehub/ui';
import { PlusIcon, WebhookIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import AsyncBoundary from '@/components/AsyncBoundary';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import AgentBreadcrumb from '@/features/AgentBreadcrumb';
import AgentProfileTabs, { AGENT_PROFILE_TABS_CENTER_STYLE } from '@/features/AgentProfileTabs';
import NavHeader from '@/features/NavHeader';
import WideScreenContainer from '@/features/WideScreenContainer';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import { useAgentWebhooks } from './useAgentWebhooks';
import { openWebhookFormModal } from './WebhookFormModal';
import WebhookItem from './WebhookItem';

const PageSkeleton = createSurfaceSkeleton('list');

interface AgentWebhookProps {
  agentId: string;
  /** Read-only member: webhooks stay visible, nothing can be created. */
  disabled?: boolean;
}

/**
 * The agent's webhooks: URLs any outside system can POST to, each call waking the agent with what
 * it sent. The one primary action is creating a webhook; everything about an existing one lives on
 * its own block.
 */
const WebhookPage = ({ agentId, disabled }: AgentWebhookProps) => {
  // The `agent` namespace loads lazily; painting before it arrives would show raw keys.
  const { t, ready } = useTranslation('agent');
  const navigate = useWorkspaceAwareNavigate();
  const enabled = useServerConfigStore(serverConfigSelectors.enableWebhook);
  const configLoaded = useServerConfigStore((s) => s.serverConfigLoaded);
  const { addRow, data, error, isLoading, reload, removeRow, replaceRow } =
    useAgentWebhooks(agentId);
  // The webhook created on this visit opens with "How to call" showing.
  const [createdId, setCreatedId] = useState<string>();
  const rows = data ?? [];
  // Until the server config loads, the flag reads as its default, not as the deployment's answer.
  const unavailable = configLoaded && !enabled;

  useEffect(() => {
    if (unavailable) navigate(urlJoin('/agent', agentId, 'profile'), { replace: true });
  }, [agentId, navigate, unavailable]);

  if (unavailable) return null;
  if (!ready) return <PageSkeleton />;

  const create = () =>
    openWebhookFormModal({
      agentId,
      onSaved: (item) => {
        addRow(item);
        setCreatedId(item.id);
      },
    });

  return (
    <Flexbox height={'100%'} width={'100%'}>
      <NavHeader
        left={<AgentBreadcrumb agentId={agentId} />}
        // `relative` anchors the absolutely-centered switcher below.
        style={{ position: 'relative' }}
        right={
          !disabled && rows.length > 0 ? (
            <Button icon={PlusIcon} size={'small'} type={'primary'} onClick={create}>
              {t('webhook.create')}
            </Button>
          ) : undefined
        }
        styles={{
          center: AGENT_PROFILE_TABS_CENTER_STYLE,
          left: { minWidth: 0, paddingInlineStart: 8 },
        }}
      >
        <AgentProfileTabs active={'webhook'} agentId={agentId} />
      </NavHeader>
      <Flexbox flex={1} style={{ overflowY: 'auto' }} width={'100%'}>
        <WideScreenContainer>
          <Flexbox gap={16} paddingBlock={16}>
            <Text type={'secondary'}>{t('webhook.desc')}</Text>
            <AsyncBoundary
              data={data}
              error={error}
              errorVariant={'block'}
              isEmpty={rows.length === 0}
              isLoading={isLoading}
              empty={
                <Center gap={16} paddingBlock={48}>
                  <Empty
                    description={t('webhook.empty.desc')}
                    descriptionProps={{ style: { maxWidth: '48ch' } }}
                    icon={WebhookIcon}
                    title={t('webhook.empty.title')}
                  />
                  {!disabled && (
                    <Button icon={PlusIcon} type={'primary'} onClick={create}>
                      {t('webhook.create')}
                    </Button>
                  )}
                </Center>
              }
              onRetry={() => void reload()}
            >
              <Flexbox gap={12}>
                {rows.map((item) => (
                  <WebhookItem
                    agentId={agentId}
                    defaultSection={item.id === createdId ? 'usage' : undefined}
                    item={item}
                    key={item.id}
                    onChange={replaceRow}
                    onRemoved={removeRow}
                  />
                ))}
              </Flexbox>
            </AsyncBoundary>
          </Flexbox>
        </WideScreenContainer>
      </Flexbox>
    </Flexbox>
  );
};

/** Keyed so nothing opened on one agent's page carries over to another's. */
const AgentWebhook = (props: AgentWebhookProps) => <WebhookPage key={props.agentId} {...props} />;

export default AgentWebhook;
