import { Button, Icon, toast } from '@lobehub/ui';
import dayjs from 'dayjs';
import { MonitorSmartphone } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProviderName } from '@/hooks/useProviderName';
import { getLlmExecutorDeclarationFor } from '@/services/llmRelay';
import { useChatStore } from '@/store/chat';

import { dataSelectors, useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';

/**
 * Parks this client already tried to pick up on its own, so a pick-up that
 * parks again (the call went out before the socket counted) leaves the rest to
 * the user's click instead of looping.
 */
const autoContinued = new Set<string>();

interface ClientLlmWaitingCardProps {
  expiresAt?: string;
  id: string;
  provider: string;
}

const ClientLlmWaitingCard = memo<ClientLlmWaitingCardProps>(({ expiresAt, id, provider }) => {
  const { t } = useTranslation('chat');
  const providerName = useProviderName(provider);
  const context = useConversationStore((s) => s.context);
  const operationId = useConversationStore(
    (s) => dataSelectors.getDbMessageById(id)(s)?.metadata?.operationId,
  );
  const updateMessageError = useConversationStore((s) => s.updateMessageError);
  const [loading, setLoading] = useState(false);

  // Only a client that declares it can run the provider may take the call.
  const canContinueHere = !!operationId && !!getLlmExecutorDeclarationFor(provider);

  const continueHere = useCallback(
    async (automatic: boolean) => {
      if (!operationId) return;
      setLoading(true);
      try {
        const resumed = await useChatStore.getState().continueClientLlmWait({
          agentId: context.agentId,
          assistantMessageId: id,
          operationId,
          provider,
          threadId: context.threadId,
          topicId: context.topicId ?? undefined,
        });
        if (resumed) {
          await updateMessageError(id, null);
        } else if (!automatic) {
          toast.info(t('clientLlmWait.notWaiting'));
        }
      } catch (error) {
        console.error('[ClientLlmWaitingCard] Failed to continue the run:', error);
        if (!automatic) toast.error(t('clientLlmWait.continueFailed'));
      } finally {
        setLoading(false);
      }
    },
    [
      context.agentId,
      context.threadId,
      context.topicId,
      id,
      operationId,
      provider,
      t,
      updateMessageError,
    ],
  );

  // This client coming online is what the run waits for: pick it up once.
  useEffect(() => {
    if (!canContinueHere || !operationId) return;
    const key = `${operationId}:${expiresAt ?? ''}`;
    if (autoContinued.has(key)) return;
    autoContinued.add(key);
    void continueHere(true);
  }, [canContinueHere, continueHere, expiresAt, operationId]);

  const time = expiresAt ? dayjs(expiresAt).format('HH:mm') : '';

  return (
    <BaseErrorForm
      avatar={<Icon icon={MonitorSmartphone} size={24} />}
      title={t('clientLlmWait.title', { provider: providerName })}
      action={
        canContinueHere ? (
          <Button loading={loading} type={'primary'} onClick={() => void continueHere(false)}>
            {t('clientLlmWait.continue')}
          </Button>
        ) : undefined
      }
      desc={t(canContinueHere ? 'clientLlmWait.descHere' : 'clientLlmWait.descElsewhere', {
        provider: providerName,
        time,
      })}
    />
  );
});

ClientLlmWaitingCard.displayName = 'ClientLlmWaitingCard';

export default ClientLlmWaitingCard;
