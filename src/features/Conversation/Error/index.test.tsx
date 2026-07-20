import type * as businessConstModule from '@lobechat/business-const';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import type * as modelRuntimeModule from '@lobechat/model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import type * as lobechatTypesModule from '@lobechat/types';
import type * as lobehubUiModule from '@lobehub/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorMessageExtra from './index';

const navigateMock = vi.fn();
const updateMessageErrorMock = vi.fn();

const serverConfigMock = vi.hoisted(() => ({ enableBusinessFeatures: false }));

vi.mock('@lobechat/business-const', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof businessConstModule;

  return {
    ...actual,
  };
});

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

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof lobehubUiModule;

  return {
    ...actual,
    Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
    Skeleton: {
      ...actual.Skeleton,
      Button: () => <div>loading</div>,
    },
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/business/client/hooks/useBusinessErrorAlertConfig', () => ({
  default: () => undefined,
}));

vi.mock('@/business/client/hooks/useBusinessErrorContent', () => ({
  default: () => ({ errorType: undefined, hideMessage: false }),
}));

vi.mock('@/business/client/hooks/useRenderBusinessChatErrorMessageExtra', () => ({
  default: () => undefined,
}));

vi.mock('@/features/Conversation/ChatItem/components/ErrorContent', () => ({
  default: ({ error }: { error?: { extra?: ReactNode; message?: string } }) => (
    <div>
      <div>{error?.message}</div>
      {error?.extra}
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
  default: () => () => <div>dynamic</div>,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: () => serverConfigMock.enableBusinessFeatures,
  },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/features/Conversation/store', () => ({
  dataSelectors: {
    getDisplayMessageById: () => () => undefined,
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      delAndRegenerateMessage: vi.fn(),
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

describe('ErrorMessageExtra', () => {
  beforeEach(() => {
    serverConfigMock.enableBusinessFeatures = false;
    updateMessageErrorMock.mockClear();
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
});
