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
import { dataSelectors, useConversationStore } from '@/features/Conversation/store';
import HeterogeneousAgentStatusGuide from '@/features/Electron/HeterogeneousAgent/StatusGuide';
import type { HeterogeneousAgentScheduleState } from '@/features/Electron/HeterogeneousAgent/StatusGuide/types';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useProviderName } from '@/hooks/useProviderName';
import dynamic from '@/libs/next/dynamic';
import { useChatStore } from '@/store/chat';
import { topicSelectors } from '@/store/chat/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { getRuntimeErrorMessage } from '@/utils/locale/runtimeErrorMessage';

import ChatInvalidAPIKey from './ChatInvalidApiKey';
import { isHeterogeneousAgentStatusGuideError } from './heterogeneous';
import { useHeterogeneousAutoRetry } from './useHeterogeneousAutoRetry';

// Re-export so existing barrel consumers (ContentBlock, message action bar) can
// keep importing the guard from '@/features/Conversation/Error'.
export { isHeterogeneousAgentStatusGuideError } from './heterogeneous';

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

const isGoogleBlockedProviderError = (error?: ChatMessageError | null): boolean => {
  if (error?.type !== 'ProviderBizError') return false;

  const body = error.body as
    | {
        context?: {
          finishReason?: unknown;
          promptFeedback?: {
            blockReason?: unknown;
          };
        };
        provider?: unknown;
      }
    | undefined;

  if (body?.provider !== 'google') return false;

  return (
    typeof body.context?.promptFeedback?.blockReason === 'string' ||
    typeof body.context?.finishReason === 'string'
  );
};

const shouldShowTraceIdError = (
  error?: ChatMessageError | null,
): error is ChatMessageError & { body: { traceId: string } } => {
  if (typeof error?.body?.traceId !== 'string') return false;
  if (isGoogleBlockedProviderError(error)) return false;

  const errorType = error.type;
  if (errorType === undefined || errorType === null) return true;
  if (typeof errorType === 'number') return false;

  const spec = getErrorCodeSpec(String(errorType));
  if (spec?.isFallback) return true;

  return !hasLocalizedErrorMessage(errorType);
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
  /**
   * Stable scope key for the overloaded auto-retry counter (the parent user
   * message id). The group surface must pass it explicitly because its
   * `data.id` is a nested child block, not a top-level displayMessage; the
   * standalone surface omits it and the parent is resolved from `data.id`.
   */
  retryScopeId?: string;
}

const ErrorMessageExtra = memo<ErrorExtraProps>(
  ({ error: alertError, data, onRegenerate, retryScopeId }) => {
    const error = data.error;
    const navigate = useWorkspaceAwareNavigate();
    const businessChatErrorMessageExtra = useRenderBusinessChatErrorMessageExtra(error, data.id);
    const enableBusinessFeatures = useServerConfigStore(
      serverConfigSelectors.enableBusinessFeatures,
    );
    const { allowed: canCreate } = usePermission('create_content');
    const sessionErrorBody = error?.body;
    const rawErrorMessage = getRawErrorMessage(error) || alertError?.message;

    const delAndRegenerateMessage = useConversationStore((s) => s.delAndRegenerateMessage);
    const resetHeteroOverloadRetry = useConversationStore((s) => s.resetHeteroOverloadRetry);
    // Standalone surface: data.id is the top-level assistant message, so its
    // parentId is the user message. Group surface passes retryScopeId directly.
    const resolvedScopeId = useConversationStore(
      (s) => retryScopeId ?? dataSelectors.getDisplayMessageById(data.id)(s)?.parentId,
    );

    const handleRetryAgentMessage = useCallback(() => {
      if (!canCreate) return;
      if (onRegenerate) {
        onRegenerate();
        return;
      }
      // Replace the failed attempt in place (delete-first, then regenerate) so
      // a transient overload/auto-retry doesn't pollute history with sibling
      // branches. Regenerate-first would switch the branch away before the
      // delete, leaving the failed attempt behind on each retry.
      void delAndRegenerateMessage(data.id);
    }, [canCreate, data.id, delAndRegenerateMessage, onRegenerate]);

    // A human-initiated retry restarts the auto-retry budget so the user isn't
    // stuck on the manual card after the cap was reached automatically.
    const handleManualRetry = useCallback(() => {
      if (resolvedScopeId) resetHeteroOverloadRetry(resolvedScopeId);
      handleRetryAgentMessage();
    }, [handleRetryAgentMessage, resetHeteroOverloadRetry, resolvedScopeId]);

    const autoRetry = useHeterogeneousAutoRetry({
      // Must be an actual heterogeneous-agent (CC / Codex) overloaded error —
      // not just any ChatMessageError whose body happens to carry
      // `code: 'overloaded'`. This guard runs before the same predicate gates
      // the guide render below, so without it a provider/tool error rendering
      // the normal card could be silently retried.
      enabled:
        canCreate &&
        isHeterogeneousAgentStatusGuideError(sessionErrorBody) &&
        sessionErrorBody.code === HeterogeneousAgentSessionErrorCode.Overloaded,
      onRetry: handleRetryAgentMessage,
      scopeId: resolvedScopeId,
    });

    // Rate-limit waits are hours, not seconds, so instead of auto-retrying we let
    // the user hand the continuation off to the backend (topic `scheduled`). All
    // orchestration lives in the conversation store; this only binds the actions.
    const scheduleHeteroContinuation = useConversationStore((s) => s.scheduleHeteroContinuation);
    const cancelHeteroContinuation = useConversationStore((s) => s.cancelHeteroContinuation);
    const activeTopicScheduled = useChatStore(
      (s) => topicSelectors.currentActiveTopic(s)?.status === 'scheduled',
    );
    const scheduledResetsAt = useChatStore((s) => {
      const scheduledRun = topicSelectors.currentActiveTopic(s)?.metadata?.scheduledRun;
      return scheduledRun?.kind === 'resume_after_rate_limit'
        ? scheduledRun.rateLimit?.resetsAt
        : undefined;
    });

    const isRateLimitError =
      canCreate &&
      isHeterogeneousAgentStatusGuideError(sessionErrorBody) &&
      sessionErrorBody.code === HeterogeneousAgentSessionErrorCode.RateLimit;
    const rateLimitInfo = isHeterogeneousAgentStatusGuideError(sessionErrorBody)
      ? sessionErrorBody.rateLimitInfo
      : undefined;

    const schedule: HeterogeneousAgentScheduleState | undefined = isRateLimitError
      ? {
          isScheduled: activeTopicScheduled,
          onCancel: () => void cancelHeteroContinuation(),
          onRunNow: () => void onRegenerate?.(),
          onSchedule: () =>
            void scheduleHeteroContinuation({
              failedAssistantMessageId: data.id,
              rateLimit: {
                rateLimitType: rateLimitInfo?.rateLimitType,
                resetsAt: rateLimitInfo?.resetsAt,
              },
            }),
          resetsAt: scheduledResetsAt ?? rateLimitInfo?.resetsAt,
        }
      : undefined;

    if (isHeterogeneousAgentStatusGuideError(sessionErrorBody)) {
      return (
        <HeterogeneousAgentStatusGuide
          agentType={sessionErrorBody.agentType}
          autoRetry={autoRetry}
          error={sessionErrorBody}
          schedule={schedule}
          onOpenSystemTools={() => navigate('/settings/system-tools')}
          onRetry={handleManualRetry}
        />
      );
    }

    if (enableBusinessFeatures && businessChatErrorMessageExtra)
      return businessChatErrorMessageExtra;

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

      case AgentRuntimeErrorType.QuotaLimitReached:
      case AgentRuntimeErrorType.RateLimitExceeded: {
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

    // Show a report action for unknown or fallback-bucket traceable errors.
    // Specific known error types keep their dedicated localized message below.
    if (enableBusinessFeatures && shouldShowTraceIdError(error)) {
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
  },
);

export default ErrorMessageExtra;
