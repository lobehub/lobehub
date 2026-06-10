import type { HeterogeneousAgentSessionError } from '@lobechat/electron-client-ipc';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { type ILobeAgentRuntimeErrorType } from '@lobechat/model-runtime';
import { AgentRuntimeErrorType, getErrorCodeSpec } from '@lobechat/model-runtime';
import { type ChatMessageError, type ErrorType, type IToolErrorType } from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { type AlertProps } from '@lobehub/ui';
import { Block, Highlighter, Skeleton } from '@lobehub/ui';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import useBusinessErrorAlertConfig from '@/business/client/hooks/useBusinessErrorAlertConfig';
import useBusinessErrorContent from '@/business/client/hooks/useBusinessErrorContent';
import useRenderBusinessChatErrorMessageExtra from '@/business/client/hooks/useRenderBusinessChatErrorMessageExtra';
import ErrorContent from '@/features/Conversation/ChatItem/components/ErrorContent';
import { useConversationStore } from '@/features/Conversation/store';
import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useProviderName } from '@/hooks/useProviderName';
import dynamic from '@/libs/next/dynamic';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

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

const PlanLimitCard = dynamic(() => import('./PlanLimitCard'), { loading, ssr: false });

const DeprecatedModelError = dynamic(() => import('./DeprecatedModelError'), {
  loading,
  ssr: false,
});

const QuotaLimitError = dynamic(() => import('./QuotaLimitError'), { loading, ssr: false });

const TraceIdError = dynamic(() => import('./TraceIdError'), { loading, ssr: false });

const HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES = new Set<string>([
  HeterogeneousAgentSessionErrorCode.AuthRequired,
  HeterogeneousAgentSessionErrorCode.CliNotFound,
  HeterogeneousAgentSessionErrorCode.Overloaded,
  HeterogeneousAgentSessionErrorCode.RateLimit,
]);

// `UnknownChatFetchError` is excluded: its localized copy is a generic
// "unknown error" message, so the trace-id report UI is strictly more useful.
const LEGACY_LOCALIZED_ERROR_TYPES = new Set<string>(
  Object.values(ChatErrorType)
    .map(String)
    .filter((type) => type !== ChatErrorType.UnknownChatFetchError),
);

/**
 * Whether `getRuntimeErrorMessage` resolves a dedicated localized message for
 * this error type — known runtime codes (spec table) plus legacy
 * `error:response.<X>` entries (ChatErrorType members and HTTP status codes).
 */
const hasLocalizedErrorMessage = (
  errorType?: IToolErrorType | ILobeAgentRuntimeErrorType | ErrorType,
): boolean => {
  if (errorType === undefined || errorType === null) return false;
  if (typeof errorType === 'number') return true;
  if (getErrorCodeSpec(String(errorType))) return true;
  return LEGACY_LOCALIZED_ERROR_TYPES.has(String(errorType));
};

const isHeterogeneousAgentStatusGuideError = (
  value: unknown,
): value is HeterogeneousAgentSessionError => {
  if (!value || typeof value !== 'object') return false;

  const { agentType, code } = value as Partial<HeterogeneousAgentSessionError>;

  return (
    (agentType === 'claude-code' || agentType === 'codex') &&
    typeof code === 'string' &&
    HETEROGENEOUS_AGENT_STATUS_GUIDE_ERROR_CODES.has(code)
  );
};

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
  const { t } = useTranslation(['error', 'modelRuntime']);
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
      : getRuntimeErrorMessage(t, finalErrorType, { provider: providerName });

    return {
      message: translatedMessage || rawErrorMessage,
      ...alertConfig,
    };
  }, [businessAlertConfig, businessErrorType, error, hideMessage, providerName, t]);
};

interface ErrorExtraProps {
  data: ErrorMessageData;
  error?: AlertProps;
  onRegenerate?: () => void;
}

const ErrorMessageExtra = memo<ErrorExtraProps>(({ error: alertError, data, onRegenerate }) => {
  const error = data.error;
  const navigate = useWorkspaceAwareNavigate();
  const businessChatErrorMessageExtra = useRenderBusinessChatErrorMessageExtra(error, data.id);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const { allowed: canCreate } = usePermission('create_content');
  const sessionErrorBody = error?.body;
  const rawErrorMessage = getRawErrorMessage(error) || alertError?.message;

  const regenerateAssistantMessage = useConversationStore((s) => s.regenerateAssistantMessage);
  const deleteMessage = useConversationStore((s) => s.deleteMessage);
  const handleRetryAgentMessage = useCallback(() => {
    if (!canCreate) return;
    if (onRegenerate) {
      onRegenerate();
      return;
    }
    regenerateAssistantMessage(data.id);
    if (data.error) deleteMessage(data.id);
  }, [canCreate, data.error, data.id, deleteMessage, onRegenerate, regenerateAssistantMessage]);

  if (isHeterogeneousAgentStatusGuideError(sessionErrorBody)) {
    return (
      <HeterogeneousAgentStatusGuide
        agentType={sessionErrorBody.agentType}
        error={sessionErrorBody}
        onOpenSystemTools={() => navigate('/settings/system-tools')}
        onRetry={handleRetryAgentMessage}
      />
    );
  }

  if (enableBusinessFeatures && businessChatErrorMessageExtra) return businessChatErrorMessageExtra;

  switch (error?.type) {
    // Lightweight fallbacks for cloud billing errors, used in builds without a
    // business override (e.g. desktop). The business hook above takes
    // precedence when installed.
    case ChatErrorType.FreePlanLimit:
    case ChatErrorType.SubscriptionPlanLimit:
    case ChatErrorType.InsufficientBudgetForModel: {
      if (enableBusinessFeatures)
        return (
          <PlanLimitCard
            errorBody={error?.body}
            errorType={error?.type}
            onRetry={handleRetryAgentMessage}
          />
        );
      break;
    }

    case ChatErrorType.LobeHubModelDeprecated: {
      if (enableBusinessFeatures)
        return <DeprecatedModelError requestedModel={error?.body?.requestedModel} />;
      break;
    }

    case AgentRuntimeErrorType.QuotaLimitReached: {
      if (enableBusinessFeatures) return <QuotaLimitError id={data.id} />;
      break;
    }

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

  // Show a report action for unknown traceable errors instead of the raw body.
  // Error types with a dedicated localized message keep the ErrorContent below.
  if (
    enableBusinessFeatures &&
    !hasLocalizedErrorMessage(error?.type) &&
    typeof error?.body?.traceId === 'string'
  ) {
    return <TraceIdError id={data.id} traceId={error.body.traceId} />;
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
      onRegenerate={canCreate ? onRegenerate : undefined}
    />
  );
});

export default ErrorMessageExtra;
