import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import type * as modelRuntimeModule from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import type * as lobechatTypesModule from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorMessageExtra, { useErrorContent } from './index';

const navigateMock = vi.fn();
const updateMessageErrorMock = vi.fn();
const dynamicComponentPropsMock = vi.hoisted(() => vi.fn());

const serverConfigMock = vi.hoisted(() => ({ enableBusinessFeatures: false }));
const delAndRegenerateMessageMock = vi.hoisted(() => vi.fn());
// Keyed by message id so a test can decide whether `data.id` is a top-level
// displayMessage hanging off a user turn — the condition that decides whether a
// self-contained retry can actually do anything.
const displayMessageMock = vi.hoisted(() => new Map<string, { parentId?: string }>());
// Stands in for whatever card a downstream build installs into the business slot.
const businessSlot = vi.hoisted(() => ({ render: false }));
const missingTranslationKeys = vi.hoisted(() => new Set<string>());
const businessErrorContentMock = vi.hoisted(() =>
  vi.fn(() => ({
    errorType: undefined,
    hideMessage: false,
    message: undefined as string | undefined,
  })),
);

vi.mock('@lobechat/model-runtime', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof modelRuntimeModule;

  return {
    ...actual,
    AgentRuntimeErrorType: {
      ...actual.AgentRuntimeErrorType,
      AgentRuntimeError: 'AgentRuntimeError',
    },
  };
});

vi.mock('@lobechat/types', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof lobechatTypesModule;

  return {
    ...actual,
    ChatErrorType: {
      ...actual.ChatErrorType,
      SystemTimeNotMatchError: 'SystemTimeNotMatchError',
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      missingTranslationKeys.has(key) ? (options?.defaultValue ?? key) : key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/business/client/hooks/useBusinessErrorAlertConfig', () => ({
  default: () => undefined,
}));

vi.mock('@/business/client/hooks/useBusinessErrorContent', () => ({
  default: businessErrorContentMock,
}));

vi.mock('@/business/client/hooks/useRenderBusinessChatErrorMessageExtra', () => ({
  default: (_error: unknown, _messageId: string, options?: { onRetry?: () => void }) =>
    businessSlot.render ? (
      <button onClick={() => options?.onRetry?.()}>business-retry</button>
    ) : undefined,
}));

vi.mock('@/features/Conversation/ChatItem/components/ErrorContent', () => ({
  default: ({
    error,
    onRegenerate,
  }: {
    error?: { extra?: ReactNode; message?: string };
    onRegenerate?: () => void;
  }) => (
    <div>
      <div>{error?.message}</div>
      {error?.extra}
      {onRegenerate && <button onClick={onRegenerate}>card-retry</button>}
    </div>
  ),
}));

vi.mock('@/features/Electron/HeterogeneousAgent/StatusGuide', () => ({
  default: ({
    agentType,
    error,
    onDismiss,
  }: {
    agentType?: string;
    error?: { code?: string };
    onDismiss?: () => void;
  }) => (
    <div>
      {`guide:${agentType}:${error?.code}`}
      {onDismiss && <button onClick={onDismiss}>dismiss</button>}
    </div>
  ),
}));

vi.mock('@/hooks/useProviderName', () => ({
  useProviderName: () => 'Mock Provider',
}));

vi.mock('@/libs/next/dynamic', () => ({
  default: () => (props: { onRetry?: () => void }) => {
    dynamicComponentPropsMock(props);

    return (
      <div>
        dynamic
        {props.onRetry && <button onClick={props.onRetry}>dynamic-retry</button>}
      </div>
    );
  },
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: () => serverConfigMock.enableBusinessFeatures,
  },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDisplayMessageById: (id: string) => () => displayMessageMock.get(id),
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      delAndRegenerateMessage: delAndRegenerateMessageMock,
      deleteMessage: vi.fn(),
      heteroOverloadRetryAttempts: {},
      internal_beginHeteroOverloadWait: vi.fn(),
      internal_endHeteroOverloadWait: vi.fn(),
      isHeteroOverloadWaitAborted: () => false,
      markHeteroOverloadRetryExhausted: vi.fn(),
      recordHeteroOverloadRetry: vi.fn(),
      resetHeteroOverloadRetry: vi.fn(),
      updateMessageError: updateMessageErrorMock,
    }),
}));

const ErrorMessageWithContent = ({ data }: { data: any }) => {
  const error = useErrorContent(data.error);

  return <ErrorMessageExtra data={data} error={error} />;
};

describe('ErrorMessageExtra', () => {
  beforeEach(() => {
    dynamicComponentPropsMock.mockClear();
    missingTranslationKeys.clear();
    businessSlot.render = false;
    serverConfigMock.enableBusinessFeatures = false;
    businessErrorContentMock.mockReturnValue({
      errorType: undefined,
      hideMessage: false,
      message: undefined,
    });
    updateMessageErrorMock.mockClear();
    delAndRegenerateMessageMock.mockClear();
    displayMessageMock.clear();
  });

  // Regression: the standalone surfaces (Assistant / Task / AgentCouncil) render
  // this card through `customErrorRender` WITHOUT an `onRegenerate`, and the
  // retry affordance used to be gated on that prop. Verified live: a plain
  // assistant turn that failed showed a card reading "…or retry" whose only
  // button was the close ×, while the identical error inside an assistantGroup
  // offered a working retry.
  describe('self-contained retry when no onRegenerate is supplied', () => {
    it('renders a retry on a standalone message that has a parent user turn', () => {
      displayMessageMock.set('msg-standalone', { parentId: 'user-1' });

      render(
        <ErrorMessageExtra
          error={{ message: 'provider exploded' }}
          data={{
            error: { body: { provider: 'openai' }, type: 'ProviderBizError' } as any,
            id: 'msg-standalone',
          }}
        />,
      );

      fireEvent.click(screen.getByText('card-retry'));

      expect(delAndRegenerateMessageMock).toHaveBeenCalledWith('msg-standalone');
    });

    it('does not advertise a retry that could not do anything', () => {
      // No entry in displayMessageMock: `data.id` is a nested block rather than a
      // top-level displayMessage, so delete-and-regenerate would delete it and
      // regenerate nothing.
      render(
        <ErrorMessageExtra
          error={{ message: 'provider exploded' }}
          data={{
            error: { body: { provider: 'openai' }, type: 'ProviderBizError' } as any,
            id: 'msg-orphan-block',
          }}
        />,
      );

      expect(screen.queryByText('card-retry')).toBeNull();
    });

    it('offers the trace-id report card a retry as well', () => {
      serverConfigMock.enableBusinessFeatures = true;
      displayMessageMock.set('msg-trace', { parentId: 'user-1' });

      render(
        <ErrorMessageExtra
          error={{ message: 'unknown' }}
          data={{
            error: { body: { traceId: 'trace-abc' } } as any,
            id: 'msg-trace',
          }}
        />,
      );

      fireEvent.click(screen.getByText('dynamic-retry'));

      expect(delAndRegenerateMessageMock).toHaveBeenCalledWith('msg-trace');
    });
  });

  it('keeps the localized message for known error types even when a traceId exists', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.LocationNotSupportError' }}
        data={{
          error: {
            body: { traceId: 'trace-123' },
            type: 'LocationNotSupportError',
          } as any,
          id: 'msg-known-trace',
        }}
      />,
    );

    // Not swallowed by the TraceIdError fallback (rendered via mocked dynamic)
    expect(screen.queryByText('dynamic')).not.toBeInTheDocument();
    expect(screen.getByText('response.LocationNotSupportError')).toBeInTheDocument();
  });

  it('shows the trace-id report UI for unknown traceable errors', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.SomeUnmappedError' }}
        data={{
          error: {
            body: { traceId: 'trace-456' },
            type: 'SomeUnmappedError',
          } as any,
          id: 'msg-unknown-trace',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
  });

  it('shows the server error UI for internal errors without exposing the raw message', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'Sensitive internal configuration error' }}
        data={{
          error: {
            body: { name: 'Error' },
            message: 'Sensitive internal configuration error',
            type: ChatErrorType.InternalServerError,
          },
          id: 'msg-internal-error',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
    expect(screen.queryByText('Sensitive internal configuration error')).not.toBeInTheDocument();
  });

  it('keeps the group retry callback on the internal server error UI', () => {
    serverConfigMock.enableBusinessFeatures = true;
    const onRegenerate = vi.fn();

    render(
      <ErrorMessageExtra
        error={{ message: 'Sensitive internal configuration error' }}
        retryScopeId="group-parent"
        data={{
          error: {
            body: { name: 'Error' },
            message: 'Sensitive internal configuration error',
            type: ChatErrorType.InternalServerError,
          },
          id: 'group-child-error',
        }}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'dynamic-retry' }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('hands the group retry to the business card so a multi-step run can resume', () => {
    serverConfigMock.enableBusinessFeatures = true;
    businessSlot.render = true;
    const onRegenerate = vi.fn();

    render(
      <ErrorMessageExtra
        error={{ message: 'response.InsufficientBudgetForModel' }}
        retryScopeId="group-parent"
        data={{
          error: {
            type: ChatErrorType.InsufficientBudgetForModel,
          } as any,
          // A nested content block of an assistantGroup — not a top-level
          // display message, so the card cannot resolve a retry from it.
          id: 'group-child-step-14',
        }}
        onRegenerate={onRegenerate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'business-retry' }));

    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it('shows the trace-id report UI for fallback provider errors', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.ProviderBizError' }}
        data={{
          error: {
            body: { traceId: 'trace-provider' },
            type: 'ProviderBizError',
          } as any,
          id: 'msg-provider-fallback',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
  });

  it('keeps localized Google block errors even when ProviderBizError carries a traceId', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.GoogleAIBlockReason.SAFETY' }}
        data={{
          error: {
            body: {
              context: {
                promptFeedback: {
                  blockReason: 'SAFETY',
                },
              },
              message: 'response.GoogleAIBlockReason.SAFETY',
              provider: 'google',
              traceId: 'trace-google-block',
            },
            message: 'response.GoogleAIBlockReason.SAFETY',
            type: 'ProviderBizError',
          } as any,
          id: 'msg-google-block-trace',
        }}
      />,
    );

    expect(screen.queryByText('dynamic')).not.toBeInTheDocument();
    expect(screen.getByText('response.GoogleAIBlockReason.SAFETY')).toBeInTheDocument();
  });

  it('renders the business rate-limit fallback for the canonical runtime code', () => {
    serverConfigMock.enableBusinessFeatures = true;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.RateLimitExceeded' }}
        data={{
          error: {
            type: AgentRuntimeErrorType.RateLimitExceeded,
          } as any,
          id: 'msg-rate-limit-runtime',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
  });

  it('renders the auth guide when the refreshed error is missing type but still carries session code', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.AuthRequired,
              message: 'Failed to authenticate',
            },
            message: 'Failed to authenticate',
          } as any,
          id: 'msg-auth',
        }}
      />,
    );

    expect(screen.getByText('guide:claude-code:auth_required')).toBeInTheDocument();
  });

  it('renders the rate-limit guide when the refreshed error carries rate_limit code', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
              message: "You've hit your limit · resets 9am (Asia/Shanghai)",
            },
            message: "You've hit your limit · resets 9am (Asia/Shanghai)",
          } as any,
          id: 'msg-rate-limit',
        }}
      />,
    );

    expect(screen.getByText('guide:claude-code:rate_limit')).toBeInTheDocument();
  });

  it('renders the working-directory guide instead of the CLI install guide', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'codex',
              code: HeterogeneousAgentSessionErrorCode.WorkingDirectoryNotFound,
              message: 'Working directory does not exist: /tmp/deleted-worktree',
              workingDirectory: '/tmp/deleted-worktree',
            },
            message: 'Working directory does not exist: /tmp/deleted-worktree',
          } as any,
          id: 'msg-working-directory',
        }}
      />,
    );

    expect(screen.getByText('guide:codex:working_directory_not_found')).toBeInTheDocument();
  });

  it('dismisses only the current heterogeneous error field', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
            },
          } as any,
          id: 'failed-step-2',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));

    expect(updateMessageErrorMock).toHaveBeenCalledWith('failed-step-2', null);
  });

  it('renders the heterogeneous guide from the session body without relying on the top-level error type', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.ServerAgentRuntimeError' }}
        data={{
          error: {
            body: {
              agentType: 'claude-code',
              clearEchoedContent: true,
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
              message: "You've hit your limit · resets May 17 at 2am (Asia/Shanghai)",
              rateLimitInfo: {
                isUsingOverage: false,
                overageDisabledReason: 'org_level_disabled',
                overageStatus: 'rejected',
                rateLimitType: 'seven_day',
                resetsAt: 1778954400,
                status: 'rejected',
              },
              stderr: "You've hit your limit · resets May 17 at 2am (Asia/Shanghai)",
            },
            message: "You've hit your limit · resets May 17 at 2am (Asia/Shanghai)",
            type: 'ServerAgentRuntimeError',
          } as any,
          id: 'msg-rate-limit-wrapped',
        }}
      />,
    );

    expect(screen.getByText('guide:claude-code:rate_limit')).toBeInTheDocument();
  });

  it('falls back to the raw error message instead of rendering a blank block', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: { detail: 'raw detail' },
            message: 'Raw runtime error',
          } as any,
          id: 'msg-raw',
        }}
      />,
    );

    expect(screen.getByText('Raw runtime error')).toBeInTheDocument();
    expect(screen.getByText(/"detail": "raw detail"/)).toBeInTheDocument();
  });

  it('shows the localized empty-completion message while retaining the raw error in details', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.ModelEmptyCompletion' }}
        data={{
          error: {
            body: { diagnostics: { attempt: 1, maxAttempts: 1, outputTokens: 25_617 } },
            message: 'The model provider returned an empty completion.',
            type: AgentRuntimeErrorType.ModelEmptyCompletion,
          } as any,
          id: 'msg-empty-completion',
        }}
      />,
    );

    expect(screen.getByText('response.ModelEmptyCompletion')).toBeInTheDocument();
    expect(
      screen.getByText(/"message": "The model provider returned an empty completion\."/),
    ).toBeInTheDocument();
  });

  it('prefers the business message while retaining the standard error details', () => {
    businessErrorContentMock.mockReturnValue({
      errorType: undefined,
      hideMessage: false,
      message: 'This request cost 5.98M credits.',
    });

    render(
      <ErrorMessageWithContent
        data={{
          error: {
            body: { diagnostics: { cost: 5.980_015, provider: 'lobehub' } },
            message: 'The model provider returned an empty completion.',
            type: AgentRuntimeErrorType.ModelEmptyCompletion,
          } as any,
          id: 'msg-empty-completion-cost',
        }}
      />,
    );

    expect(screen.getByText('This request cost 5.98M credits.')).toBeInTheDocument();
    expect(
      screen.getByText(/"message": "The model provider returned an empty completion\."/),
    ).toBeInTheDocument();
  });

  it('falls back to the raw message for a known error when localized content is unavailable', () => {
    missingTranslationKeys.add('modelRuntime:ExceededToolLimit');

    render(
      <ErrorMessageWithContent
        data={{
          error: {
            message: 'The provider rejected the tool count.',
            type: AgentRuntimeErrorType.ExceededToolLimit,
          } as any,
          id: 'msg-tool-limit-raw-fallback',
        }}
      />,
    );

    expect(screen.getByText('The provider rejected the tool count.')).toBeInTheDocument();
    expect(screen.queryByText('modelRuntime:ExceededToolLimit')).not.toBeInTheDocument();
  });
});
