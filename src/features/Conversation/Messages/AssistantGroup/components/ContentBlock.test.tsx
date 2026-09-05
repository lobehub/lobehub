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
const retryFailedAssistantStepMock = vi.fn();
const navigateMock = vi.fn();
let isInReasoningMock = false;

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
      retryFailedAssistantStep: retryFailedAssistantStepMock,
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
    retryFailedAssistantStepMock.mockClear();
    navigateMock.mockClear();
    isInReasoningMock = false;
  });

  it('delegates a retry to the store instead of hand-rolling delete + continue', () => {
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

    // The component must not decide anything itself. It used to delete the failed
    // block and then call `continueGeneration`, which could silently find nothing
    // to continue and leave the turn deleted with nothing running. The store owns
    // the routing (hetero resume / continue in place / replace the turn) because
    // only it can guarantee a terminal outcome.
    expect(retryFailedAssistantStepMock).toHaveBeenCalledWith('assistant-1', 'block-1');
    expect(deleteDBMessageMock).not.toHaveBeenCalled();
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
    // persisted for multi-turn replay but must not render a card.
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

  it('renders nothing for an empty block waiting for its first stream chunk', () => {
    // A new step block mounts before any content/reasoning streams and before
    // the reasoning op starts. Rendering an empty wrapper would consume a flex
    // gap slot in the block list and visibly push the next sibling down.
    const { container } = render(
      <ContentBlock assistantId="assistant-1" content="" id="block-1" />,
    );

    expect(container).toBeEmptyDOMElement();
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
