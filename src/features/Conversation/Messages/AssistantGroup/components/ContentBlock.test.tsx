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
const navigateMock = vi.fn();

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

vi.mock('react-router-dom', () => ({
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
  default: ({ agentType, error }: { agentType?: string; error?: { code?: string } }) => (
    <div>{`guide:${agentType}:${error?.code}`}</div>
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

vi.mock('../../components/Reasoning', () => ({
  default: () => <div>reasoning</div>,
}));

vi.mock('../Tools', () => ({
  Tools: () => <div>tools</div>,
}));

vi.mock('./MessageContent', () => ({
  default: () => <div>message content</div>,
}));

vi.mock('../../../store', () => ({
  messageStateSelectors: {
    isMessageInReasoning: () => () => false,
  },
  useConversationStore: (selector: (state: unknown) => unknown) =>
    selector({
      continueGeneration: continueGenerationMock,
      deleteDBMessage: deleteDBMessageMock,
    }),
}));

describe('AssistantGroup ContentBlock', () => {
  beforeEach(() => {
    continueGenerationMock.mockClear();
    deleteDBMessageMock.mockClear();
    navigateMock.mockClear();
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
});
