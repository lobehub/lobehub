import { ProviderIcon } from '@lobehub/icons';
import { Button, Center, Flexbox } from '@lobehub/ui';
import { ModelProvider } from 'model-bank';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type GlobalLLMProviderKey } from '@/types/user/settings';

import BedrockForm from './Bedrock';
import ComfyUIForm from './ComfyUIForm';
import { LoadingContext } from './LoadingContext';
import ProviderApiKeyForm from './ProviderApiKeyForm';

interface APIKeyFormProps {
  bedrockDescription: string;
  description: string;
  id: string;
  onClose: () => void;
  onRecreate: () => void;
  provider?: string;
}

const APIKeyForm = memo<APIKeyFormProps>(
  ({ provider, description, bedrockDescription, onRecreate, onClose }) => {
    const { t } = useTranslation('error');
    const [loading, setLoading] = useState(false);

    const apiKeyPlaceholder = useMemo(() => {
      switch (provider) {
        case ModelProvider.Anthropic: {
          return 'sk-ant_*****************************';
        }

        case ModelProvider.OpenRouter: {
          return 'sk-or-********************************';
        }

        case ModelProvider.Perplexity: {
          return 'pplx-********************************';
        }

        case ModelProvider.ZhiPu: {
          return '*********************.*************';
        }

        case ModelProvider.Groq: {
          return 'gsk_*****************************';
        }

        case ModelProvider.DeepSeek: {
          return 'sk_******************************';
        }

        case ModelProvider.Qwen: {
          return 'sk-********************************';
        }

        case ModelProvider.Github: {
          return 'ghp_*****************************';
        }

        default: {
          return '*********************************';
        }
      }
    }, [provider]);

    return (
      <LoadingContext value={{ loading, setLoading }}>
        <Center
          gap={16}
          style={{
            maxWidth: provider === ModelProvider.ComfyUI ? 900 : 300,
            width: provider === ModelProvider.ComfyUI ? '80%' : 'auto',
          }}
        >
          {provider === ModelProvider.Bedrock ? (
            <BedrockForm description={bedrockDescription} />
          ) : provider === ModelProvider.ComfyUI ? (
            <ComfyUIForm description={description} />
          ) : (
            <ProviderApiKeyForm
              showEndpoint
              apiKeyPlaceholder={apiKeyPlaceholder}
              avatar={<ProviderIcon provider={provider} size={80} type={'avatar'} />}
              description={description}
              provider={provider as GlobalLLMProviderKey}
            />
          )}
          <Flexbox gap={12} width={'100%'}>
            <Button
              block
              disabled={loading}
              style={{ marginTop: 8 }}
              type={'primary'}
              onClick={() => {
                onRecreate();
              }}
            >
              {t('unlock.confirm')}
            </Button>
            <Button
              onClick={() => {
                onClose();
              }}
            >
              {t('unlock.closeMessage')}
            </Button>
          </Flexbox>
        </Center>
      </LoadingContext>
    );
  },
);

export default APIKeyForm;
