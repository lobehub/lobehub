import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import { ModelProvider } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useProviderName } from '@/hooks/useProviderName';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

import { useConversationStore } from '../store';
import BaseErrorForm from './BaseErrorForm';

interface ChatInvalidAPIKeyProps {
  id: string;
  provider?: string;
}
const ChatInvalidAPIKey = memo<ChatInvalidAPIKeyProps>(({ id, provider }) => {
  const { t } = useTranslation(['modelProvider', 'error']);
  const navigate = useWorkspaceAwareNavigate();
  const [deleteMessage] = useConversationStore((s) => [s.deleteMessage]);
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
