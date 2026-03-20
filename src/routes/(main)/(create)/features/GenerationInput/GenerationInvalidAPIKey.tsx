'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import { ModelProvider } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useProviderName } from '@/hooks/useProviderName';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

interface GenerationInvalidAPIKeyProps {
  onNavigate?: () => void;
  provider?: string;
}

const GenerationInvalidAPIKey = memo<GenerationInvalidAPIKeyProps>(({ provider, onNavigate }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const navigate = useNavigate();
  const providerName = useProviderName(provider as GlobalLLMProviderKey);

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
