import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui/base-ui';
import { ModelProvider } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProviderName } from '@/hooks/useProviderName';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';
import { isAicoManagedProviderMode } from './isAicoManagedProviderMode';
import ManagedKeyError from './ManagedKeyError';

const isManagedRuntimeProvider = (provider?: string) =>
  provider === 'aico' || provider === 'openrouter';

interface ChatInvalidAPIKeyProps {
  id: string;
  provider?: string;
}
const ChatInvalidAPIKey = memo<ChatInvalidAPIKeyProps>(({ id, provider }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const navigate = useWorkspaceAwareNavigate();
  const [deleteMessage] = useConversationStore((s) => [s.deleteMessage]);
  const providerName = useProviderName(provider as GlobalLLMProviderKey);

  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  if (isAicoManagedProviderMode(managedStatus?.managed)) {
    // Native openai/google/… selections do not use the wallet key — prompt a
    // model switch instead of the misleading “top up wallet” card.
    const reason = provider && !isManagedRuntimeProvider(provider) ? 'wrongProvider' : 'funds';
    return <ManagedKeyError reason={reason} onNavigate={() => deleteMessage(id)} />;
  }

  return (
    <BaseErrorForm
      avatar={<ProviderIcon provider={provider} shape={'square'} size={40} />}
      title={t(`unlock.apiKey.title`, { name: providerName, ns: 'error' })}
      action={
        <Button
          type={'primary'}
          onClick={() => {
            navigate(urlJoin('/settings/provider', provider || 'all'));
            deleteMessage(id);
          }}
        >
          {t('unlock.goToSettings', { ns: 'error' })}
        </Button>
      }
      desc={
        provider === ModelProvider.Bedrock
          ? t('bedrock.unlock.description')
          : t(`unlock.apiKey.description`, {
              name: providerName,
              ns: 'error',
            })
      }
    />
  );
});

export default ChatInvalidAPIKey;
