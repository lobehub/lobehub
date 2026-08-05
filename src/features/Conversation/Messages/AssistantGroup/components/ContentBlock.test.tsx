/**
 * @vitest-environment happy-dom
 */
import { HeterogeneousAgentSessionErrorCode } from '@lobechat/electron-client-ipc';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ContentBlock from './ContentBlock';

const continueGenerationMock = vi.fn();
const deleteDBMessageMock = vi.fn();
const continueHeteroAfterErrorMock = vi.fn();
const navigateMock = vi.fn();
let isInReasoningMock = false;

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Flexbox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Highlighter: ({ children }: { children?: ReactNode }) => <pre>{children}</pre>,
  Skeleton: {
    Button: () => <div>loading</div>,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en-US',
      resolvedLanguage: 'en-US',
    },
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

vi.mock('@/features/Electron/HeterogeneousAgent/StatusGuide', () => ({
  default: ({
    agentType,
    error,
    onRetry,
  }: {
    agentType?: string;
    error?: { code?: string };
    onRetry?: () => void;
  }) => (
    <div>
      {`guide:${agentType}:${error?.code}`}
      <button type="button" onClick={onRetry}>
        guide-retry
      </button>
    </div>
  ),
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true }),
}));

vi.mock('@/hooks/useProviderName', () => ({
  useProviderName: () => 'Mock Provider',
}));

vi.mock('@/libs/next/dynamic', () => ({
  default: () => () => <div>dynamic</div>,
}));

vi.mock('@/store/serverConfig', () => ({
  serverConfigSelectors: {
    enableBusinessFeatures: () => false,
  },
  useServerConfigStore: (selector: (s: unknown) => unknown) => selector({}),
}));

vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('../../../ChatItem/components/ErrorContent', () => ({
  default: ({
    customErrorRender,
    error,
  }: {
    customErrorRender?: (error: Record<string, unknown>) => ReactNode;
    error?: Record<string, unknown>;
  }) => <>{customErrorRender ? customErrorRender(error || {}) : error?.message}</>,
}));

vi.mock('../../components/ImageFileListViewer', () => ({
  default: () => <div>images</div>,
}));

vi.mock('../../components/Reasoning', async (importOriginal) => ({
  // keep the real hasRenderableReasoning predicate — these tests exercise it
  ...(await importOriginal<Record<string, unknown>>()),
  default: () => <div>reasoning</div>,
}));

vi.mock('../Tools', () => ({
  Tools: () => <div>tools</div>,
}));

vi.mock('./MessageContent', () => ({
  default: () => <div>message content</div>,
}));

vi.mock('../../../store', () => ({
  dataSelectors: {
    getDisplayMessageById: () => () => ({ parentId: 'user-1' }),
  },
  messageStateSelectors: {
    isMessageInReasoning: () => () => isInReasoningMock,
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      continueGeneration: continueGenerationMock,
      continueHeteroAfterError: continueHeteroAfterErrorMock,
      deleteDBMessage: deleteDBMessageMock,
      heteroOverloadRetryAttempts: {},
      internal_beginHeteroOverloadWait: vi.fn(),
      internal_endHeteroOverloadWait: vi.fn(),
      isHeteroOverloadWaitAborted: () => false,
      markHeteroOverloadRetryExhausted: vi.fn(),
      recordHeteroOverloadRetry: vi.fn(),
      resetHeteroOverloadRetry: vi.fn(),
    }),
}));

describe('AssistantGroup ContentBlock', () => {
  beforeEach(() => {
    continueGenerationMock.mockClear();
    deleteDBMessageMock.mockClear();
    continueHeteroAfterErrorMock.mockClear();
    navigateMock.mockClear();
    isInReasoningMock = false;
  });

  it('resumes the run (not the no-op continueGeneration) when retrying a heterogeneous error in a group', () => {
    render(
      <ContentBlock
        assistantId="assistant-1"
        content=""
        id="block-1"
        error={
          {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.Overloaded,
              message: 'API Error: 529 overloaded_error',
              stderr: 'API Error: 529 overloaded_error',
            },
            message: 'API Error: 529 overloaded_error',
            type: 'AgentRuntimeError',
          } as any
        }
      />,
    );

    screen.getByRole('button', { name: 'guide-retry' }).click();

    // Retrying a grouped hetero turn resumes it from the GROUP id — dropping only
    // the failed step and picking the CLI session back up — instead of calling
    // continueGeneration, which is a no-op for hetero runtimes.
    expect(continueHeteroAfterErrorMock).toHaveBeenCalledWith('assistant-1');
    expect(continueGenerationMock).not.toHaveBeenCalled();
  });

  it('uses the shared message error renderer for heterogeneous agent errors', () => {
    render(
      <ContentBlock
        assistantId="assistant-1"
        content=""
        id="block-1"
        error={
          {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
              message: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
              rateLimitInfo: {
                rateLimitType: 'five_hour',
                resetsAt: 1_778_741_400,
                status: 'rejected',
              },
              stderr: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
            },
            message: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
            type: 'AgentRuntimeError',
          } as any
        }
      />,
    );

    expect(screen.getByText('guide:claude-code:rate_limit')).toBeInTheDocument();
  });

  it('does not render an empty reasoning card for signature-only reasoning', () => {
    // Some providers (e.g. DeepSeek over the Anthropic protocol) emit a thinking
    // block with only a signature_delta and zero thinking text. The signature is
    // persisted for multi-turn replay but must not render a card. See LOBE-12829.
    render(
      <ContentBlock
        assistantId="assistant-1"
        content="final answer"
        id="block-1"
        reasoning={{ signature: '395a9e64-8cfb-4e4b-a8b8-f11f5d5e2181' }}
      />,
    );

    expect(screen.queryByText('reasoning')).not.toBeInTheDocument();
    expect(screen.getByText('message content')).toBeInTheDocument();
  });

  it('renders reasoning when content is present alongside a signature', () => {
    render(
      <ContentBlock
        assistantId="assistant-1"
        content="final answer"
        id="block-1"
        reasoning={{ content: 'let me think', signature: 'sig' }}
      />,
    );

    expect(screen.getByText('reasoning')).toBeInTheDocument();
  });

  it('does not render a reasoning card for whitespace-only content', () => {
    render(
      <ContentBlock
        assistantId="assistant-1"
        content="final answer"
        id="block-1"
        reasoning={{ content: '   ' }}
      />,
    );

    expect(screen.queryByText('reasoning')).not.toBeInTheDocument();
  });

  it('renders multimodal reasoning that streams tempDisplayContent without content', () => {
    // StreamingHandler emits { isMultimodal, tempDisplayContent } with no content
    // while image reasoning parts stream — must not be treated as signature-only.
    render(
      <ContentBlock
        assistantId="assistant-1"
        content=""
        id="block-1"
        reasoning={{
          isMultimodal: true,
          tempDisplayContent: [{ image: 'data:image/png;base64,b64', type: 'image' }],
        }}
      />,
    );

    expect(screen.getByText('reasoning')).toBeInTheDocument();
  });

  it('keeps the streaming reasoning placeholder when no reasoning object exists yet', () => {
    isInReasoningMock = true;

    render(<ContentBlock assistantId="assistant-1" content="" id="block-1" />);

    expect(screen.getByText('reasoning')).toBeInTheDocument();
  });

  it('renders the error below the content when a turn errors after streaming content', () => {
    render(
      <ContentBlock
        assistantId="assistant-1"
        content="The assistant already wrote this before the turn died."
        id="block-1"
        error={
          {
            body: {
              agentType: 'claude-code',
              code: HeterogeneousAgentSessionErrorCode.RateLimit,
              message: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
              rateLimitInfo: {
                rateLimitType: 'five_hour',
                resetsAt: 1_778_741_400,
                status: 'rejected',
              },
              stderr: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
            },
            message: "You've hit your limit · resets 2:50pm (Asia/Shanghai)",
            type: 'AgentRuntimeError',
          } as any
        }
      />,
    );

    // Content is preserved AND the error is surfaced, instead of being dropped.
    expect(screen.getByText('message content')).toBeInTheDocument();
    expect(screen.getByText('guide:claude-code:rate_limit')).toBeInTheDocument();
  });
});
