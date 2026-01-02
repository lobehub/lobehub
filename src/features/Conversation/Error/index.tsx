import { AgentRuntimeErrorType, type ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import { ChatErrorType, type ChatMessageError, type ErrorType } from '@lobechat/types';
import { type IPluginErrorType } from '@lobehub/chat-plugin-sdk';
import { type AlertProps, Block, Highlighter, Skeleton } from '@lobehub/ui';
import dynamic from 'next/dynamic';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import { useProviderName } from '@/hooks/useProviderName';

import ChatInvalidAPIKey from './ChatInvalidApiKey';

interface ErrorMessageData {
  error?: ChatMessageError | null;
  id: string;
}

const loading = () => (
  <Block
    align={'center'}
    padding={16}
    style={{
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }}
    variant={'outlined'}
  >
    <Skeleton.Button active block />
  </Block>
);

const OllamaBizError = dynamic(() => import('./OllamaBizError'), { loading, ssr: false });

const OllamaSetupGuide = dynamic(() => import('./OllamaSetupGuide'), {
  loading,
  ssr: false,
});

// Config for the errorMessage display
const getErrorAlertConfig = (
  errorType?: IPluginErrorType | ILobeAgentRuntimeErrorType | ErrorType,
): AlertProps | undefined => {
  // OpenAIBizError / ZhipuBizError / GoogleBizError / ...
  if (typeof errorType === 'string' && (errorType.includes('Biz') || errorType.includes('Invalid')))
    return {
      type: 'secondary',
    };

  /* ↓ cloud slot ↓ */

  /* ↑ cloud slot ↑ */

  switch (errorType) {
    case ChatErrorType.SystemTimeNotMatchError:
    case AgentRuntimeErrorType.PermissionDenied:
    case AgentRuntimeErrorType.InsufficientQuota:
    case AgentRuntimeErrorType.ModelNotFound:
    case AgentRuntimeErrorType.QuotaLimitReached:
    case AgentRuntimeErrorType.ExceededContextWindow:
    case AgentRuntimeErrorType.LocationNotSupportError: {
      return {
        type: 'secondary',
      };
    }

    case AgentRuntimeErrorType.OllamaServiceUnavailable:
    case AgentRuntimeErrorType.NoOpenAIAPIKey:
    case AgentRuntimeErrorType.ComfyUIServiceUnavailable:
    case AgentRuntimeErrorType.InvalidComfyUIArgs: {
      return {
        type: 'secondary',
      };
    }

    default: {
      return undefined;
    }
  }
};

export const useErrorContent = (error: any) => {
  const { t } = useTranslation('error');
  const providerName = useProviderName(error?.body?.provider || '');

  return useMemo<AlertProps | undefined>(() => {
    if (!error) return;
    const messageError = error;

    const alertConfig = getErrorAlertConfig(messageError.type);

    return {
      message: t(`response.${messageError.type}` as any, { provider: providerName }),
      ...alertConfig,
    };
  }, [error]);
};

interface ErrorExtraProps {
  data: ErrorMessageData;
  error?: AlertProps;
}

const ErrorMessageExtra = memo<ErrorExtraProps>(({ error: alertError, data }) => {
  const error = data.error as ChatMessageError;
  if (!error?.type) return;

  switch (error.type) {
    case AgentRuntimeErrorType.OllamaServiceUnavailable: {
      return <OllamaSetupGuide id={data.id} />;
    }

    case AgentRuntimeErrorType.OllamaBizError: {
      return <OllamaBizError {...data} />;
    }

    /* ↓ cloud slot ↓ */

    /* ↑ cloud slot ↑ */

    case AgentRuntimeErrorType.NoOpenAIAPIKey: {
      {
        return <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} />;
      }
    }
  }

  if (error.type.toString().includes('Invalid')) {
    return <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} />;
  }

  return (
    <ErrorContent
      error={{
        ...alertError,
        extra: data.error?.body ? (
          <Highlighter
            actionIconSize={'small'}
            language={'json'}
            padding={8}
            variant={'borderless'}
          >
            {JSON.stringify(data.error?.body, null, 2)}
          </Highlighter>
        ) : undefined,
      }}
      id={data.id}
    />
  );
});

export default ErrorMessageExtra;
