import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { type ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import { type ChatMessageError, type ErrorType, type IToolErrorType } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { type AlertProps } from '@lobehub/ui';
import { Block, Highlighter, Skeleton } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import useBusinessErrorAlertConfig from '@/business/client/hooks/useBusinessErrorAlertConfig';
import useBusinessErrorContent from '@/business/client/hooks/useBusinessErrorContent';
import useRenderBusinessChatErrorMessageExtra from '@/business/client/hooks/useRenderBusinessChatErrorMessageExtra';
import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import { useProviderName } from '@/hooks/useProviderName';
import dynamic from '@/libs/next/dynamic';

import ChatInvalidAPIKey from './ChatInvalidApiKey';

interface ErrorMessageData {
  error?: ChatMessageError | null;
  id: string;
}

const getRawErrorMessage = (error?: ChatMessageError | null) => {
  if (!error) return;

  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }

  if (
    error.body &&
    typeof error.body === 'object' &&
    'message' in error.body &&
    typeof error.body.message === 'string' &&
    error.body.message.trim()
  ) {
    return error.body.message;
  }

  return;
};

const loading = () => (
  <Block
    align={'center'}
    padding={16}
    variant={'outlined'}
    style={{
      overflow: 'hidden',
      position: 'relative',
      width: '100%',
    }}
  >
    <Skeleton.Button active block />
  </Block>
);

const ExceededContextWindowError = dynamic(() => import('./ExceededContextWindowError'), {
  loading,
  ssr: false,
});

const OllamaBizError = dynamic(() => import('./OllamaBizError'), { loading, ssr: false });

const OllamaSetupGuide = dynamic(() => import('./OllamaSetupGuide'), {
  loading,
  ssr: false,
});

// Config for the errorMessage display
const getErrorAlertConfig = (
  errorType?: IToolErrorType | ILobeAgentRuntimeErrorType | ErrorType,
): AlertProps | undefined => {
  // OpenAIBizError / ZhipuBizError / GoogleBizError / ...
  if (typeof errorType === 'string' && (errorType.includes('Biz') || errorType.includes('Invalid')))
    return {
      type: 'secondary',
    };

  switch (errorType) {
    case ChatErrorType.SystemTimeNotMatchError:
    case AgentRuntimeErrorType.AccountDeactivated:
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
  const businessAlertConfig = useBusinessErrorAlertConfig(error?.type);
  const { errorType: businessErrorType, hideMessage } = useBusinessErrorContent(error?.type);

  return useMemo<AlertProps | undefined>(() => {
    if (!error) return;
    const messageError = error;
    const rawErrorMessage = getRawErrorMessage(messageError);

    if (!messageError.type) {
      if (!rawErrorMessage) return;

      return {
        message: rawErrorMessage,
        type: 'secondary',
      };
    }

    // Use business alert config if provided, otherwise fall back to default
    const alertConfig = businessAlertConfig ?? getErrorAlertConfig(messageError.type);

    // Use business error type if provided, otherwise use original
    const finalErrorType = businessErrorType ?? messageError.type;
    const translatedMessage = hideMessage
      ? undefined
      : t(`response.${finalErrorType}` as any, { provider: providerName });

    return {
      message: translatedMessage || rawErrorMessage,
      ...alertConfig,
    };
  }, [businessAlertConfig, businessErrorType, error, hideMessage, providerName, t]);
};

interface ErrorExtraProps {
  data: ErrorMessageData;
  error?: AlertProps;
}

const ErrorMessageExtra = memo<ErrorExtraProps>(({ error: alertError, data }) => {
  const error = data.error;
  const navigate = useNavigate();
  const businessChatErrorMessageExtra = useRenderBusinessChatErrorMessageExtra(error, data.id);
  const sessionErrorCode = error?.body?.code;
  const sessionAgentType = error?.body?.agentType;
  const sessionErrorBody = error?.body;
  const rawErrorMessage = getRawErrorMessage(error) || alertError?.message;

  if (ENABLE_BUSINESS_FEATURES && businessChatErrorMessageExtra)
    return businessChatErrorMessageExtra;

  if (
    (error?.type === AgentRuntimeErrorType.AgentRuntimeError || !error?.type) &&
    !!sessionErrorBody &&
    (sessionErrorCode === HeterogeneousAgentSessionErrorCode.AuthRequired ||
      sessionErrorCode === HeterogeneousAgentSessionErrorCode.CliNotFound ||
      sessionErrorCode === HeterogeneousAgentSessionErrorCode.RateLimit) &&
    (sessionAgentType === 'claude-code' || sessionAgentType === 'codex')
  ) {
    return (
      <HeterogeneousAgentStatusGuide
        agentType={sessionAgentType}
        error={sessionErrorBody}
        onOpenSystemTools={() => navigate('/settings/system-tools')}
      />
    );
  }

  switch (error?.type) {
    case AgentRuntimeErrorType.OllamaServiceUnavailable: {
      return <OllamaSetupGuide id={data.id} />;
    }

    case AgentRuntimeErrorType.OllamaBizError: {
      return <OllamaBizError {...data} />;
    }

    case AgentRuntimeErrorType.ExceededContextWindow: {
      return <ExceededContextWindowError id={data.id} />;
    }

    case AgentRuntimeErrorType.NoOpenAIAPIKey: {
      {
        return <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} />;
      }
    }
  }

  if (error?.type?.toString().includes('Invalid')) {
    return <ChatInvalidAPIKey id={data.id} provider={data.error?.body?.provider} />;
  }

  return (
    <ErrorContent
      id={data.id}
      error={{
        ...alertError,
        ...(rawErrorMessage ? { message: rawErrorMessage } : {}),
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
    />
  );
});

export default ErrorMessageExtra;
