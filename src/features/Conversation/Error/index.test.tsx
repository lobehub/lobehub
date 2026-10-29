import type * as lobechatConstModule from '@lobechat/const';
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import type * as lobechatTypesModule from '@lobechat/types';
import { AgentRuntimeErrorType, ChatErrorType } from '@lobechat/types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';

import ErrorMessageExtra, { useErrorContent } from './index';

const navigateMock = vi.fn();
const updateMessageErrorMock = vi.fn();
const dynamicComponentPropsMock = vi.hoisted(() => vi.fn());

const serverConfigMock = vi.hoisted(() => ({ enableBusinessFeatures: false }));
const shareContextMock = vi.hoisted(() => ({ topicShareId: '' }));
const transcriptSourceMock = vi.hoisted(() => ({ value: 'chat' as 'chat' | 'static' }));
const delAndRegenerateMessageMock = vi.hoisted(() => vi.fn());
const detectHeterogeneousAgentCommandMock = vi.hoisted(() => vi.fn());
const cancelHeteroContinuationMock = vi.hoisted(() => vi.fn());
// Keyed by message id so a test can decide whether `data.id` is a top-level
// displayMessage hanging off a user turn — the condition that decides whether a
// self-contained retry can actually do anything.
const displayMessageMock = vi.hoisted(() => new Map<string, { parentId?: string }>());
const conversationContextMock = vi.hoisted(
  () =>
    ({ agentId: undefined, topicId: undefined }) as {
      agentId?: string;
      topicId?: string;
    },
);
const createTopicForwardModalMock = vi.hoisted(() => vi.fn());
const commitWorkingDirectoryMock = vi.hoisted(() => vi.fn());
// Stands in for whatever card a downstream build installs into the business slot.
const businessSlot = vi.hoisted(() => ({ render: false }));
const resourceAccessMock = vi.hoisted(() => ({ canUseResource: true }));
const missingTranslationKeys = vi.hoisted(() => new Set<string>());
const businessErrorContentMock = vi.hoisted(() =>
  vi.fn(() => ({
    errorType: undefined,
    hideMessage: false,
    message: undefined as string | undefined,
  })),
);

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof lobechatConstModule;

  return { ...actual, isDesktop: true };
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
    onRetry,
    onHandoff,
    workingDirectoryReset,
  }: {
    agentType?: string;
    error?: { code?: string };
    onDismiss?: () => void;
    onRetry?: () => void;
    onHandoff?: () => void;
    workingDirectoryReset?: { name?: string; onReset: () => Promise<void> };
  }) => (
    <div>
      {`guide:${agentType}:${error?.code}`}
      {onDismiss && <button onClick={onDismiss}>dismiss</button>}
      {onRetry && <button onClick={onRetry}>guide-retry</button>}
      {onHandoff && <button onClick={onHandoff}>handoff</button>}
      {workingDirectoryReset && (
        <button onClick={() => void workingDirectoryReset.onReset()}>
          {`reset-to:${workingDirectoryReset.name}`}
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/features/ChatInput/ControlBar/useCommitWorkingDirectory', () => ({
  useCommitWorkingDirectory: () => ({ commit: commitWorkingDirectoryMock }),
}));

vi.mock('@/services/electron/binary', () => ({
  binaryService: {
    detectHeterogeneousAgentCommand: detectHeterogeneousAgentCommandMock,
  },
}));

vi.mock('@/features/Conversation/MessageForward/TopicForwardModal', () => ({
  createTopicForwardModal: createTopicForwardModalMock,
}));

vi.mock('@/features/Conversation/hooks/useConversationResourceAccess', () => ({
  useConversationResourceAccess: () => resourceAccessMock,
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
  contextSelectors: {
    agentId: (state: { context: typeof conversationContextMock }) => state.context.agentId,
    topicId: (state: { context: typeof conversationContextMock }) => state.context.topicId,
  },
  dataSelectors: {
    getDisplayMessageById: (id: string) => () => displayMessageMock.get(id),
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      context: { ...conversationContextMock, ...shareContextMock },
      transcriptSource: transcriptSourceMock.value,
      cancelHeteroContinuation: cancelHeteroContinuationMock,
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

// Highlighter renders the JSON as token spans once its engine has loaded, so match the whole block.
const getErrorDetails = (pattern: RegExp) =>
  screen.getByText(
    (_, element) => element?.tagName === 'PRE' && pattern.test(element.textContent ?? ''),
  );

describe('ErrorMessageExtra', () => {
  beforeEach(() => {
    dynamicComponentPropsMock.mockClear();
    detectHeterogeneousAgentCommandMock.mockReset();
    detectHeterogeneousAgentCommandMock.mockResolvedValue({ available: true });
    missingTranslationKeys.clear();
    businessSlot.render = false;
    resourceAccessMock.canUseResource = true;
    serverConfigMock.enableBusinessFeatures = false;
    shareContextMock.topicShareId = '';
    transcriptSourceMock.value = 'chat';
    businessErrorContentMock.mockReturnValue({
      errorType: undefined,
      hideMessage: false,
      message: undefined,
    });
    updateMessageErrorMock.mockClear();
    delAndRegenerateMessageMock.mockClear();
    cancelHeteroContinuationMock.mockClear();
    displayMessageMock.clear();
    conversationContextMock.agentId = undefined;
    conversationContextMock.topicId = undefined;
    createTopicForwardModalMock.mockClear();
    commitWorkingDirectoryMock.mockReset();
    commitWorkingDirectoryMock.mockResolvedValue(undefined);
    useChatStore.setState({ activeTopicId: null as any, topicDetailMap: {} });
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

    it('offers no retry on a static transcript, which nothing could regenerate', () => {
      transcriptSourceMock.value = 'static';
      displayMessageMock.set('msg-static', { parentId: 'user-1' });

      render(
        <ErrorMessageExtra
          error={{ message: 'provider exploded' }}
          data={{
            error: { body: { provider: 'openai' }, type: 'ProviderBizError' } as any,
            id: 'msg-static',
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

  it('shows the copyable trace ID card without a retry on a shared topic', () => {
    shareContextMock.topicShareId = 'share-1';

    render(
      <ErrorMessageWithContent
        data={{
          error: {
            body: { traceId: 'trace-fixture-1' },
            type: ChatErrorType.InternalServerError,
          },
          id: 'msg-shared-internal-error',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
    expect(dynamicComponentPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ showRetry: false, traceId: 'trace-fixture-1' }),
    );
    expect(screen.queryByText('dynamic-retry')).not.toBeInTheDocument();
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

  it('offers context compaction for an oversized request body', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.RequestBodyTooLarge' }}
        data={{
          error: { type: AgentRuntimeErrorType.RequestBodyTooLarge } as any,
          id: 'msg-request-too-large',
        }}
      />,
    );

    expect(screen.getByText('dynamic')).toBeInTheDocument();
    expect(dynamicComponentPropsMock).toHaveBeenCalledWith({
      canCompact: true,
      id: 'msg-request-too-large',
      reason: 'requestBodyTooLarge',
    });
  });

  it('withholds context compaction from members who can only view the conversation', () => {
    resourceAccessMock.canUseResource = false;

    render(
      <ErrorMessageExtra
        error={{ message: 'response.RequestBodyTooLarge' }}
        data={{
          error: { type: AgentRuntimeErrorType.RequestBodyTooLarge } as any,
          id: 'msg-request-too-large',
        }}
      />,
    );

    expect(dynamicComponentPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ canCompact: false, reason: 'requestBodyTooLarge' }),
    );
  });

  it('lets context compaction retry the group parent when the error is a nested block', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.RequestBodyTooLarge' }}
        retryScopeId="group-parent"
        data={{
          error: { type: AgentRuntimeErrorType.RequestBodyTooLarge } as any,
          id: 'group-child-block',
        }}
        onRegenerate={vi.fn()}
      />,
    );

    expect(dynamicComponentPropsMock).toHaveBeenCalledWith({
      canCompact: true,
      id: 'group-child-block',
      parentId: 'group-parent',
      reason: 'requestBodyTooLarge',
    });
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

  it('renders the CLI detection timeout guide instead of the generic JSON error', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.AgentRuntimeError' }}
        data={{
          error: {
            body: {
              agentType: 'codex',
              code: HeterogeneousAgentSessionErrorCode.CliDetectionTimeout,
              command: 'codex',
              message: 'Timed out looking for `codex` while reading PATH from your login shell.',
            },
            type: AgentRuntimeErrorType.AgentRuntimeError,
          } as any,
          id: 'msg-cli-detection-timeout',
        }}
      />,
    );

    expect(screen.getByText('guide:codex:cli_detection_timeout')).toBeInTheDocument();
    expect(screen.queryByText(/Timed out looking for/)).not.toBeInTheDocument();
  });

  it('forces fresh CLI detection before retrying a detection timeout', async () => {
    displayMessageMock.set('msg-cli-detection-timeout', { parentId: 'user-1' });

    render(
      <ErrorMessageExtra
        error={{ message: 'response.AgentRuntimeError' }}
        data={{
          error: {
            body: {
              agentType: 'codex',
              code: HeterogeneousAgentSessionErrorCode.CliDetectionTimeout,
              command: 'codex',
              message: 'Timed out looking for `codex` while reading PATH from your login shell.',
            },
            type: AgentRuntimeErrorType.AgentRuntimeError,
          } as any,
          id: 'msg-cli-detection-timeout',
        }}
      />,
    );

    fireEvent.click(screen.getByText('guide-retry'));

    await waitFor(() => {
      expect(detectHeterogeneousAgentCommandMock).toHaveBeenCalledWith({
        agentType: 'codex',
        command: 'codex',
      });
      expect(delAndRegenerateMessageMock).toHaveBeenCalledWith('msg-cli-detection-timeout');
    });
    expect(detectHeterogeneousAgentCommandMock.mock.invocationCallOrder[0]).toBeLessThan(
      delAndRegenerateMessageMock.mock.invocationCallOrder[0],
    );
  });

  it('renders the rate-limit guide when the refreshed error carries rate_limit code', () => {
    conversationContextMock.agentId = 'source-agent';
    conversationContextMock.topicId = 'source-topic';
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
    fireEvent.click(screen.getByText('handoff'));
    expect(createTopicForwardModalMock).toHaveBeenCalledWith({
      cancelSourceContinuation: true,
      sourceAgentId: 'source-agent',
      topicId: 'source-topic',
      topicTitle: '',
    });
  });

  it('restores handoff after cancelling the source wait even when another topic is active', () => {
    useChatStore.setState({
      activeTopicId: 'main-topic',
      topicDetailMap: {
        'main-topic': {
          id: 'main-topic',
          status: 'active',
          title: 'Main topic',
        } as any,
        'source-topic': {
          id: 'source-topic',
          metadata: { scheduledRun: { kind: 'resume_after_rate_limit' } },
          status: 'scheduled',
          title: 'Review task',
        } as any,
      },
    });
    conversationContextMock.agentId = 'source-agent';
    conversationContextMock.topicId = 'source-topic';

    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'codex',
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
              message: 'rate limited',
            },
            message: 'rate limited',
          } as any,
          id: 'msg-rate-limit',
        }}
      />,
    );

    expect(screen.queryByText('handoff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dismiss' })).not.toBeInTheDocument();

    act(() => {
      useChatStore.setState((state) => ({
        topicDetailMap: {
          ...state.topicDetailMap,
          'source-topic': {
            ...state.topicDetailMap['source-topic'],
            metadata: { scheduledRun: null },
            status: 'failed',
          } as any,
        },
      }));
    });

    fireEvent.click(screen.getByText('handoff'));
    // Opening the picker does not resolve the quota error or consume the entry.
    fireEvent.click(screen.getByText('handoff'));
    expect(createTopicForwardModalMock).toHaveBeenCalledTimes(2);
    expect(cancelHeteroContinuationMock).not.toHaveBeenCalled();

    const props = createTopicForwardModalMock.mock.calls[0][0];
    expect(props.cancelSourceContinuation).toBe(true);
    expect(props.topicId).toBe('source-topic');
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

  // Regression: a project conversation hides its directory picker, so when the
  // run's `git worktree add` checkout was later removed, the topic kept spawning
  // in the dead worktree and the card's only advice pointed at a hidden picker.
  describe('deleted worktree recovery', () => {
    const renderWorktreeError = () =>
      render(
        <ErrorMessageExtra
          error={{ message: 'response.undefined' }}
          data={{
            error: {
              body: {
                agentType: 'claude-code',
                code: HeterogeneousAgentSessionErrorCode.WorkingDirectoryNotFound,
                message: 'Working directory does not exist: /tmp/ibench-push',
              },
            } as any,
            id: 'msg-dead-worktree',
          }}
        />,
      );

    beforeEach(() => {
      conversationContextMock.agentId = 'agent-1';
      conversationContextMock.topicId = 'topic-1';
      displayMessageMock.set('msg-dead-worktree', { parentId: 'user-1' });
      useChatStore.setState({
        topicDetailMap: {
          'topic-1': {
            id: 'topic-1',
            metadata: {
              workingDirectoryConfig: {
                git: { activeWorktree: '/tmp/ibench-push', isWorktree: true },
                path: '/Users/me/ibench/landing',
              },
            },
            projectWorkingDirectoryId: 'dir-1',
            title: 'Topic',
          } as any,
        },
      });
    });

    it('switches back to the source repo, then retries', async () => {
      renderWorktreeError();

      fireEvent.click(screen.getByText('reset-to:landing'));

      await waitFor(() =>
        expect(delAndRegenerateMessageMock).toHaveBeenCalledWith('msg-dead-worktree'),
      );
      expect(commitWorkingDirectoryMock).toHaveBeenCalledWith({ path: '/Users/me/ibench/landing' });
      expect(commitWorkingDirectoryMock.mock.invocationCallOrder[0]).toBeLessThan(
        delAndRegenerateMessageMock.mock.invocationCallOrder[0],
      );
    });

    it('does not retry into the dead worktree when the switch fails', async () => {
      commitWorkingDirectoryMock.mockRejectedValue(new Error('offline'));
      renderWorktreeError();

      fireEvent.click(screen.getByText('reset-to:landing'));

      await waitFor(() => expect(commitWorkingDirectoryMock).toHaveBeenCalled());
      expect(delAndRegenerateMessageMock).not.toHaveBeenCalled();
    });

    it('offers no reset when the topic records no worktree', () => {
      useChatStore.setState({
        topicDetailMap: {
          'topic-1': {
            id: 'topic-1',
            metadata: { workingDirectoryConfig: { path: '/Users/me/ibench/landing' } },
            title: 'Topic',
          } as any,
        },
      });
      renderWorktreeError();

      expect(screen.queryByText(/reset-to:/)).not.toBeInTheDocument();
      expect(screen.getByText('guide-retry')).toBeInTheDocument();
    });
  });

  it('dismisses only the current non-quota heterogeneous error field', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.undefined' }}
        data={{
          error: {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.Overloaded,
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
    expect(getErrorDetails(/"detail": "raw detail"/)).toBeInTheDocument();
  });

  it('shows a JSON gateway detail as an object instead of a twice-escaped string', () => {
    const raw = '{"error":"TIMEOUT","success":false}';
    render(
      <ErrorMessageExtra
        error={{ message: 'response.DeviceResponseTimeout' }}
        data={{
          error: {
            body: { detail: raw },
            message: raw,
            type: ChatErrorType.DeviceResponseTimeout,
          } as any,
          id: 'msg-device-timeout',
        }}
      />,
    );

    expect(screen.getByText('response.DeviceResponseTimeout')).toBeInTheDocument();
    const details = getErrorDetails(/"error": "TIMEOUT"/).textContent ?? '';
    expect(details).not.toContain('\\"');
    expect(details).not.toContain('"message"');
  });

  it('keeps a truncated JSON gateway detail as the raw string', () => {
    render(
      <ErrorMessageExtra
        error={{ message: 'response.DeviceResponseTimeout' }}
        data={{
          error: {
            body: { detail: '{"error":"TIMEOUT"' },
            message: 'The device did not answer in time.',
            type: ChatErrorType.DeviceResponseTimeout,
          } as any,
          id: 'msg-device-timeout-truncated',
        }}
      />,
    );

    expect(getErrorDetails(/"detail": "\{\\"error\\":\\"TIMEOUT\\""/)).toBeInTheDocument();
    expect(getErrorDetails(/"message": "The device did not answer in time\."/)).toBeInTheDocument();
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
      getErrorDetails(/"message": "The model provider returned an empty completion\."/),
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
      getErrorDetails(/"message": "The model provider returned an empty completion\."/),
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
