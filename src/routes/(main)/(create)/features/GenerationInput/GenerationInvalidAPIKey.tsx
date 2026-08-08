'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui/base-ui';
import { ModelProvider } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { isAicoManagedRuntimeProvider } from '@/features/AicoBilling/isManagedRuntimeProvider';
import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { isAicoManagedProviderMode } from '@/features/Conversation/Error/isAicoManagedProviderMode';
import ManagedKeyError from '@/features/Conversation/Error/ManagedKeyError';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProviderName } from '@/hooks/useProviderName';
import { useClientDataSWR } from '@/libs/swr';
import { lambdaClient } from '@/libs/trpc/client';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

interface GenerationInvalidAPIKeyProps {
  onNavigate?: () => void;
  provider?: string;
}

const GenerationInvalidAPIKey = memo<GenerationInvalidAPIKeyProps>(({ provider, onNavigate }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const navigate = useWorkspaceAwareNavigate();
  const providerName = useProviderName(provider as GlobalLLMProviderKey);

  const { data: managedStatus } = useClientDataSWR('aico-provider-status', () =>
    lambdaClient.aicoBilling.getManagedProviderStatus.query(),
  );
  if (isAicoManagedProviderMode(managedStatus?.managed)) {
    const reason = provider && !isAicoManagedRuntimeProvider(provider) ? 'wrongProvider' : 'funds';
    return <ManagedKeyError reason={reason} onNavigate={onNavigate} />;
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
            onNavigate?.();
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

GenerationInvalidAPIKey.displayName = 'GenerationInvalidAPIKey';

export default GenerationInvalidAPIKey;
