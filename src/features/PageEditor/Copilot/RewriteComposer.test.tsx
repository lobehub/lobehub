import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RewriteComposer from './RewriteComposer';

const mocks = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ request: { id: 'request-1' } }),
  continue: vi.fn().mockResolvedValue({ request: { id: 'request-2' } }),
  fetchAgentList: { error: undefined as Error | undefined, isRevalidating: false },
  home: {
    allAgents: [{ id: 'agent-1', title: 'Agent One', type: 'agent' }],
    isAgentListInit: true,
  },
  agent: {
    activeAgentId: 'agent-1' as string | undefined,
    agentMap: {
      'agent-1': { id: 'agent-1', title: 'Agent One', type: 'agent' },
      'agent-2': { id: 'agent-2', title: 'Agent Two', type: 'agent' },
    },
    builtinAgentIdMap: {},
    setActiveAgentId: vi.fn(),
    updateAgentConfigById: vi.fn(),
  },
  aiInfra: {
    enabledImageModelList: [] as Array<{
      children: Array<{ id: string; displayName?: string }>;
      id: string;
    }>,
  },
  navigate: vi.fn(),
}));

vi.mock('./rewriteRequests', () => ({
  getRewriteQuotedText: (request: { selection?: { quotedText?: string } }) =>
    request.selection?.quotedText || '',
  isPageRewriteActiveStatus: (status: string) =>
    [
      'queued',
      'connecting',
      'syncing',
      'thinking',
      'writing',
      'cancel_requested',
      'retry_wait',
    ].includes(status),
  getPageRewriteErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error && !error.message.startsWith('DOCUMENT_REWRITE_')
      ? error.message
      : fallback,
  normalizePageRewriteProgress: (value: unknown) => value ?? null,
  isPageRewriteActiveLimitError: (error: unknown) =>
    error instanceof Error && error.message.includes('DOCUMENT_REWRITE_ACTIVE_LIMIT'),
  isPageRewriteContinuationChangedError: (error: unknown) =>
    error instanceof Error && error.message.includes('DOCUMENT_REWRITE_CONTINUATION_CHANGED'),
  isPageRewriteContinuationDeletedError: (error: unknown) =>
    error instanceof Error && error.message.includes('DOCUMENT_REWRITE_CONTINUATION_DELETED'),
  isPageRewriteTargetConflictError: (error: unknown) =>
    error instanceof Error &&
    /DOCUMENT_REWRITE_REQUEST_CONFLICT.*target already active/i.test(error.message),
  PAGE_REWRITE_MAX_ACTIVE_REQUESTS: 5,
  pageRewriteRequestClient: {
    cancel: vi.fn(),
    create: mocks.create,
    continue: mocks.continue,
    list: vi.fn(),
    retry: vi.fn(),
  },
}));

vi.mock('./AgentSelector/AgentSelectorAction', () => ({
  default: () => <span data-testid="rewrite-agent-action">Agent</span>,
}));

vi.mock('./CopilotModelSelect', () => ({
  default: ({
    mode,
    onModelChange,
  }: {
    mode?: string;
    onModelChange?: (params: { model: string; provider: string }) => void;
  }) => (
    <button
      data-mode={mode}
      data-testid="rewrite-model-action"
      type="button"
      onClick={() => onModelChange?.({ model: 'model-2', provider: 'provider-2' })}
    >
      Model
    </button>
  ),
}));

vi.mock('@/store/aiInfra', () => ({
  aiProviderSelectors: {
    enabledImageModelList: (state: typeof mocks.aiInfra) => state.enabledImageModelList,
  },
  useAiInfraStore: (selector: (state: typeof mocks.aiInfra) => unknown) => selector(mocks.aiInfra),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('@/features/Conversation/ChatItem', () => ({
  ChatItem: ({
    avatar,
    message,
    messageExtra,
    placement,
    showAvatar,
    showTitle,
  }: {
    avatar?: { avatar?: string; title?: string };
    message?: string;
    messageExtra?: ReactNode;
    placement?: string;
    showAvatar?: boolean;
    showTitle?: boolean;
  }) => (
    <div
      data-avatar={avatar?.avatar}
      data-avatar-title={avatar?.title}
      data-placement={placement}
      data-show-avatar={showAvatar}
      data-show-title={showTitle}
      data-testid="mock-conversation-chat-item"
    >
      {message}
      {messageExtra}
    </div>
  ),
}));

vi.mock('@/features/PageEditor/store', () => ({
  usePageEditorStore: (selector: (state: { documentId: string }) => unknown) =>
    selector({ documentId: 'page-1' }),
}));

vi.mock('@/hooks/useFetchAgentList', () => ({
  useFetchAgentList: () => mocks.fetchAgentList,
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.agent),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentByIdSelectors: {
    getAgentById: (id: string) => (state: { agentMap: Record<string, unknown> }) =>
      state.agentMap[id],
    getAgentConfigById: () => () => ({ id: 'agent-1', title: 'Agent One', type: 'agent' }),
    getAgentModelById: () => () => 'model-1',
    getAgentModelProviderById: () => () => 'provider-1',
    isAgentHeterogeneousById: () => () => false,
  },
}));

vi.mock('@/store/home', () => ({
  useHomeStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.home),
}));

vi.mock('@/store/home/selectors', () => ({
  homeAgentListSelectors: { allAgents: (state: Record<string, unknown>) => state.allAgents },
}));

const selection = {
  endNodeId: 'node-b',
  endOffset: 8,
  kind: 'block' as const,
  quotedText: 'Selected text',
  quotedTextHash: 'fnv1a-test',
  startNodeId: 'node-a',
  startOffset: 0,
  targetNodeIds: ['node-a', 'node-b'],
};

const secondSelection = {
  ...selection,
  endNodeId: 'node-d',
  quotedText: 'Second selected text',
  startNodeId: 'node-c',
  targetNodeIds: ['node-c', 'node-d'],
};

describe('RewriteComposer', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mocks.create.mockReset();
    mocks.create.mockResolvedValue({ request: { id: 'request-1' } });
    mocks.continue.mockReset();
    mocks.continue.mockResolvedValue({ request: { id: 'request-2' } });
    mocks.fetchAgentList.error = undefined;
    mocks.fetchAgentList.isRevalidating = false;
    mocks.home.allAgents = [{ id: 'agent-1', title: 'Agent One', type: 'agent' }];
    mocks.home.isAgentListInit = true;
    mocks.agent.activeAgentId = 'agent-1';
    mocks.agent.agentMap = {
      'agent-1': { id: 'agent-1', title: 'Agent One', type: 'agent' },
      'agent-2': { id: 'agent-2', title: 'Agent Two', type: 'agent' },
    };
    mocks.agent.builtinAgentIdMap = {};
    mocks.aiInfra.enabledImageModelList = [];
    mocks.navigate.mockReset();
  });

  it('submits instruction, selected Agent, and durable selection to documentRewrite', async () => {
    const onClose = vi.fn();
    const onSubmitted = vi.fn();
    render(<RewriteComposer selection={selection} onClose={onClose} onSubmitted={onSubmitted} />);

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Make this more concise' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'page-1',
        instruction: 'Make this more concise',
        model: 'model-1',
        provider: 'provider-1',
        selection,
      }),
    );
    expect(onSubmitted).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('persists a per-turn model switch without changing the Agent default', async () => {
    const updateAgentConfigById = vi.fn();
    mocks.agent.updateAgentConfigById = updateAgentConfigById;
    render(<RewriteComposer selection={selection} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId('rewrite-model-action'));
    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Use the selected model' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'page-1',
        instruction: 'Use the selected model',
        model: 'model-2',
        provider: 'provider-2',
        selection,
      }),
    );
    expect(updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('continues an applied request through the parent id without submitting client history', async () => {
    const parent = {
      agentId: 'agent-1',
      attempt: 1,
      createdAt: '2026-08-29T00:00:00.000Z',
      documentId: 'page-1',
      id: 'request-1',
      instruction: 'Make it concise',
      model: 'session-model',
      outputText: 'A concise result',
      parentRequestId: null,
      selection,
      sessionId: 'rws_session-1',
      status: 'applied' as const,
      turnIndex: 1,
      updatedAt: '2026-08-29T00:00:00.000Z',
      provider: 'session-provider',
    };
    const onClose = vi.fn();
    render(
      <RewriteComposer
        continuationParent={parent}
        selection={{ ...selection, quotedText: parent.outputText }}
        onClose={onClose}
        onSubmitted={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Make it warmer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(mocks.continue).toHaveBeenCalledWith({
        instruction: 'Make it warmer',
        model: 'session-model',
        parentRequestId: 'request-1',
        provider: 'session-provider',
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('provides a back action for leaving continuation detail', () => {
    const onBack = vi.fn();
    render(
      <RewriteComposer
        selection={{ ...selection, quotedText: 'A concise result' }}
        continuationParent={{
          agentId: 'agent-1',
          attempt: 1,
          createdAt: '2026-08-29T00:00:00.000Z',
          documentId: 'page-1',
          id: 'request-1',
          instruction: 'Make it concise',
          outputText: 'A concise result',
          parentRequestId: null,
          selection,
          sessionId: 'rws_session-1',
          status: 'applied',
          turnIndex: 1,
          updatedAt: '2026-08-29T00:00:00.000Z',
        }}
        onBack={onBack}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to Agent edits' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders the continuation session as an alternating topic-style message flow', () => {
    const parent = {
      agentId: 'agent-1',
      attempt: 1,
      createdAt: '2026-08-29T00:00:02.000Z',
      documentId: 'page-1',
      id: 'request-2',
      instruction: 'Make the second version warmer',
      outputText: 'A warmer result',
      progress: {
        currentStage: 'reading_block' as const,
        events: [
          { at: '2026-08-29T00:00:01.000Z', stage: 'analyzing_context' as const },
          {
            at: '2026-08-29T00:00:02.000Z',
            stage: 'reading_block' as const,
            tool: 'read_document_block',
          },
        ],
        updatedAt: '2026-08-29T00:00:02.000Z',
      },
      parentRequestId: 'request-1',
      selection,
      sessionId: 'rws_session-1',
      status: 'applied' as const,
      turnIndex: 2,
      updatedAt: '2026-08-29T00:00:02.000Z',
    };
    const firstRound = {
      ...parent,
      createdAt: '2026-08-29T00:00:01.000Z',
      id: 'request-1',
      instruction: 'Make the first version concise',
      outputText: 'A concise result',
      parentRequestId: null,
      turnIndex: 1,
      updatedAt: '2026-08-29T00:00:01.000Z',
    };

    render(
      <RewriteComposer
        continuationParent={parent}
        selection={{ ...selection, quotedText: parent.outputText }}
        sessionRequests={[parent, firstRound]}
        onClose={vi.fn()}
      />,
    );

    const chat = screen.getByTestId('page-rewrite-session-chat');
    expect(chat).toBeInTheDocument();
    expect(within(chat).getByText('Selected text')).toBeInTheDocument();
    expect(within(chat).getByText('Make the first version concise')).toBeInTheDocument();
    expect(within(chat).getByText('A concise result')).toBeInTheDocument();
    expect(within(chat).getByText('Make the second version warmer')).toBeInTheDocument();
    expect(within(chat).getByText('A warmer result')).toBeInTheDocument();
    expect(within(chat).getAllByTestId('page-rewrite-session-message')).toHaveLength(5);
    expect(chat.querySelectorAll('[data-rewrite-chat-message="instruction"]')).toHaveLength(2);
    expect(chat.querySelectorAll('[data-rewrite-chat-message="output"]')).toHaveLength(2);
    expect(chat.querySelectorAll('[data-rewrite-progress-stage]')).toHaveLength(4);
    expect(
      chat.querySelector('[data-rewrite-chat-message="context"] [data-show-avatar="false"]'),
    ).toBeInTheDocument();
    expect(
      chat.querySelector('[data-rewrite-chat-message="output"] [data-avatar-title="Agent One"]'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('data-page-rewrite-selection-count', '13');
    expect(screen.getByTestId('page-rewrite-continuation-input')).toHaveStyle({
      flex: 'none',
      height: 'auto',
    });
  });

  it('collapses a long HTML reply into a bounded summary and can expand the full output', async () => {
    const longHtml = `<main>${'const value = 1;\n'.repeat(100)}</main>`;
    const parent = {
      ...selection,
      agentId: 'agent-1',
      attempt: 1,
      createdAt: '2026-08-29T00:00:01.000Z',
      documentId: 'page-1',
      id: 'request-long',
      instruction: 'Generate an HTML page',
      outputText: longHtml,
      selection,
      sessionId: 'rws-long',
      status: 'applied' as const,
      turnIndex: 1,
      updatedAt: '2026-08-29T00:00:01.000Z',
    };

    render(
      <RewriteComposer
        continuationParent={parent}
        selection={{ ...selection, quotedText: longHtml }}
        sessionRequests={[parent]}
        onClose={vi.fn()}
      />,
    );

    const chat = screen.getByTestId('page-rewrite-session-chat');
    const outputMessage = chat.querySelector('[data-rewrite-chat-message="output"]');
    expect(outputMessage?.textContent).toContain('…');
    expect(outputMessage?.textContent).not.toContain(longHtml);
    const expand = within(outputMessage as HTMLElement).getByRole('button', {
      name: 'Show full output',
    });
    await fireEvent.click(expand);
    expect(outputMessage?.textContent).toContain(longHtml);
    expect(
      within(outputMessage as HTMLElement).getByRole('button', {
        name: 'Collapse full output',
      }),
    ).toBeInTheDocument();
  });

  it('shows the selected state and counts Unicode code points', () => {
    const unicodeSelection = { ...selection, quotedText: '中文😀A' };
    render(<RewriteComposer selection={unicodeSelection} onClose={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('data-page-rewrite-selection-status', 'selected');
    expect(status).toHaveAttribute('data-page-rewrite-selection-count', '4');
    expect(status).toHaveTextContent('copilot.rewrite.selectionStatus');
  });

  it('updates the selected text and character count when the selection changes', () => {
    const { rerender } = render(<RewriteComposer selection={selection} onClose={vi.fn()} />);
    const status = screen.getByRole('status');

    expect(status).toHaveAttribute('data-page-rewrite-selection-count', '13');
    expect(screen.getByText('Selected text')).toBeInTheDocument();

    const updatedSelection = { ...selection, quotedText: '更新后的选区' };
    rerender(<RewriteComposer selection={updatedSelection} onClose={vi.fn()} />);

    expect(status).toHaveAttribute('data-page-rewrite-selection-count', '6');
    expect(screen.getByText('更新后的选区')).toBeInTheDocument();
  });

  it('keeps the instruction when an equivalent selection object is recreated', () => {
    const { rerender } = render(<RewriteComposer selection={selection} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    fireEvent.change(input, { target: { value: 'Keep this while the card rerenders' } });

    rerender(<RewriteComposer selection={{ ...selection }} onClose={vi.fn()} />);

    expect(input).toHaveValue('Keep this while the card rerenders');
  });

  it('clears the instruction when the semantic selection changes', () => {
    const { rerender } = render(<RewriteComposer selection={selection} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    fireEvent.change(input, { target: { value: 'Reset after target changes' } });

    rerender(
      <RewriteComposer
        selection={{ ...selection, endOffset: selection.endOffset + 1 }}
        onClose={vi.fn()}
      />,
    );

    expect(input).toHaveValue('');
  });

  it('focuses the instruction when a fresh selection reuses the composer instance', async () => {
    const { rerender } = render(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer selection={selection} onClose={vi.fn()} />
      </>,
    );
    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    const editorBody = screen.getByTestId('editor-body');

    await waitFor(() => expect(input).toHaveFocus());
    editorBody.focus();
    expect(editorBody).toHaveFocus();

    rerender(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer selection={secondSelection} onClose={vi.fn()} />
      </>,
    );

    // Lexical can finish returning focus to the editor after this render. The
    // composer frame must win that same-turn handoff.
    editorBody.focus();
    expect(editorBody).toHaveFocus();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('focuses the instruction when the explicit open identity changes for the same selection', async () => {
    const { rerender } = render(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer focusKey="new:1" selection={selection} onClose={vi.fn()} />
      </>,
    );
    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    const editorBody = screen.getByTestId('editor-body');

    await waitFor(() => expect(input).toHaveFocus());
    editorBody.focus();
    expect(editorBody).toHaveFocus();

    rerender(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer focusKey="new:2" selection={selection} onClose={vi.fn()} />
      </>,
    );

    editorBody.focus();
    expect(editorBody).toHaveFocus();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('focuses the instruction when the continuation request changes', async () => {
    const firstParent = {
      agentId: 'agent-1',
      attempt: 1,
      createdAt: '2026-08-29T00:00:00.000Z',
      documentId: 'page-1',
      id: 'request-1',
      instruction: 'Make it concise',
      outputText: 'A concise result',
      parentRequestId: null,
      selection,
      sessionId: 'rws_session-1',
      status: 'applied' as const,
      turnIndex: 1,
      updatedAt: '2026-08-29T00:00:00.000Z',
    };
    const secondParent = { ...firstParent, id: 'request-2', turnIndex: 2 };
    const { rerender } = render(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer
          continuationParent={firstParent}
          focusKey="continuation:request-1"
          selection={selection}
          onClose={vi.fn()}
        />
      </>,
    );
    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    const editorBody = screen.getByTestId('editor-body');

    editorBody.focus();
    expect(editorBody).toHaveFocus();

    rerender(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer
          continuationParent={secondParent}
          focusKey="continuation:request-2"
          selection={selection}
          onClose={vi.fn()}
        />
      </>,
    );

    await waitFor(() => expect(input).toHaveFocus());
  });

  it('does not reclaim focus when an active request update keeps the same composer target', async () => {
    const { rerender } = render(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer activeRequestCount={0} selection={selection} onClose={vi.fn()} />
      </>,
    );
    const editorBody = screen.getByTestId('editor-body');

    await waitFor(() =>
      expect(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder')).toHaveFocus(),
    );
    editorBody.focus();
    expect(editorBody).toHaveFocus();

    rerender(
      <>
        <button data-testid="editor-body" type="button">
          Editor
        </button>
        <RewriteComposer activeRequestCount={1} selection={selection} onClose={vi.fn()} />
      </>,
    );

    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
    expect(editorBody).toHaveFocus();
  });

  it('cancels a pending focus frame when the composer unmounts', () => {
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<RewriteComposer selection={selection} onClose={vi.fn()} />);

    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalled();
    cancelAnimationFrame.mockRestore();
  });

  it('allows a second selection to submit while the first request is active', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <RewriteComposer
        activeRequestCount={1}
        selection={selection}
        onClose={onClose}
        onSubmitted={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Rewrite the first passage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    mocks.agent.activeAgentId = 'agent-2';
    mocks.agent.agentMap = {
      'agent-1': { id: 'agent-1', title: 'Agent One', type: 'agent' },
      'agent-2': { id: 'agent-2', title: 'Agent Two', type: 'agent' },
    };
    mocks.home.allAgents = [
      { id: 'agent-1', title: 'Agent One', type: 'agent' },
      { id: 'agent-2', title: 'Agent Two', type: 'agent' },
    ];
    rerender(
      <RewriteComposer
        activeRequestCount={2}
        selection={secondSelection}
        onClose={onClose}
        onSubmitted={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Rewrite the second passage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));

    expect(mocks.create).toHaveBeenNthCalledWith(2, {
      agentId: 'agent-2',
      documentId: 'page-1',
      instruction: 'Rewrite the second passage',
      model: 'model-1',
      provider: 'provider-1',
      selection: secondSelection,
    });
  });

  it('keeps the instruction visible and reports a create failure', async () => {
    mocks.create.mockRejectedValueOnce(new Error('DOCUMENT_REWRITE_REQUEST_CONFLICT'));
    render(<RewriteComposer selection={selection} onClose={vi.fn()} />);

    const input = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    fireEvent.change(input, { target: { value: 'Try again later' } });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('copilot.rewrite.createError'),
    );
    expect(input).toHaveValue('Try again later');
  });

  it('disables submit when no Agent is available', () => {
    mocks.agent.activeAgentId = undefined;
    mocks.home.allAgents = [];
    render(<RewriteComposer selection={selection} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).toBeDisabled();
  });

  it('disables only the new request when five active requests fill the shared limit', () => {
    render(<RewriteComposer activeRequestCount={5} selection={selection} onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Wait for a slot' },
    });

    expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).toBeDisabled();
    expect(screen.getByText('copilot.rewrite.activeLimit')).toBeInTheDocument();
  });

  it('re-enables a request when one active request completes', () => {
    const { rerender } = render(
      <RewriteComposer activeRequestCount={4} selection={selection} onClose={vi.fn()} />,
    );
    const instruction = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    fireEvent.change(instruction, { target: { value: 'Use the released slot' } });
    const submit = screen.getByRole('button', { name: 'copilot.rewrite.submit' });
    expect(submit).not.toBeDisabled();

    rerender(<RewriteComposer activeRequestCount={5} selection={selection} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).toBeDisabled();

    rerender(<RewriteComposer activeRequestCount={4} selection={selection} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).not.toBeDisabled();
  });

  it('localizes server active-limit and overlapping-target errors', async () => {
    const { rerender } = render(
      <RewriteComposer activeRequestCount={4} selection={selection} onClose={vi.fn()} />,
    );
    const instruction = screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder');
    fireEvent.change(instruction, { target: { value: 'Try one more' } });
    mocks.create.mockRejectedValueOnce(new Error('DOCUMENT_REWRITE_ACTIVE_LIMIT'));
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('copilot.rewrite.activeLimit'),
    );

    rerender(<RewriteComposer activeRequestCount={4} selection={selection} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Try an overlapping target' },
    });
    mocks.create.mockRejectedValueOnce(
      new Error('DOCUMENT_REWRITE_REQUEST_CONFLICT: target already active'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('copilot.rewrite.overlapError'),
    );
  });

  it('uses the image model list for a block-image rewrite without mutating the Agent', async () => {
    mocks.aiInfra.enabledImageModelList = [
      { children: [{ id: 'openai/gpt-image-2' }], id: 'zenmux' },
    ];
    const imageSelection = {
      ...selection,
      adapterId: 'block-image',
      imagePlaceholder: false,
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    const updateAgentConfigById = vi.fn();
    mocks.agent.updateAgentConfigById = updateAgentConfigById;
    render(
      <RewriteComposer
        selection={imageSelection as never}
        onClose={vi.fn()}
        onSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByTestId('rewrite-model-action')).toHaveAttribute('data-mode', 'image');
    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.imageInstructionPlaceholder'), {
      target: { value: 'A blue mountain at sunrise' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'page-1',
        instruction: 'A blue mountain at sunrise',
        model: 'openai/gpt-image-2',
        provider: 'zenmux',
        selection: imageSelection,
      }),
    );
    expect(updateAgentConfigById).not.toHaveBeenCalled();
  });

  it('keeps the image model when a reused composer receives a new image target', async () => {
    mocks.aiInfra.enabledImageModelList = [
      { children: [{ id: 'openai/gpt-image-2' }], id: 'zenmux' },
    ];
    const firstImageSelection = {
      ...selection,
      adapterId: 'block-image',
      imagePlaceholder: true,
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    const secondImageSelection = {
      ...firstImageSelection,
      targetNodeId: 'image-2',
    };
    const { rerender } = render(
      <RewriteComposer
        focusKey="new:1"
        selection={firstImageSelection as never}
        onClose={vi.fn()}
      />,
    );
    rerender(
      <RewriteComposer
        focusKey="new:2"
        selection={secondImageSelection as never}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.imageInstructionPlaceholder'), {
      target: { value: 'Regenerate the second image' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        documentId: 'page-1',
        instruction: 'Regenerate the second image',
        model: 'openai/gpt-image-2',
        provider: 'zenmux',
        selection: secondImageSelection,
      }),
    );
  });

  it('blocks a placeholder rewrite and exposes image-model configuration when none is enabled', () => {
    const imageSelection = {
      ...selection,
      adapterId: 'block-image',
      imagePlaceholder: true,
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    render(
      <RewriteComposer
        selection={imageSelection as never}
        onClose={vi.fn()}
        onRemovePlaceholder={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('copilot.rewrite.imageModelUnavailable');
    expect(
      screen.getByRole('button', { name: 'copilot.rewrite.configureImageModel' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.configureImageModel' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/provider/all');
    const input = screen.getByPlaceholderText('copilot.rewrite.imageInstructionPlaceholder');
    fireEvent.change(input, { target: { value: 'Try another image' } });
    expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).toBeDisabled();
  });
});
