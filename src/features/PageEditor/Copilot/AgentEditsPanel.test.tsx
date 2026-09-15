import * as BaseUI from '@lobehub/ui/base-ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AgentEditsPanel from './AgentEditsPanel';

const mocks = vi.hoisted(() => ({
  client: {
    cancel: vi.fn(),
    create: vi.fn(),
    continue: vi.fn(),
    review: vi.fn(),
    retry: vi.fn(),
    deleteSession: vi.fn(),
  },
  editorSettleReview: vi.fn(),
  editorFocusProvenance: vi.fn(),
  editorHighlight: vi.fn(),
  editorHoveredSession: vi.fn(),
  editorFocusSession: vi.fn(),
  editorFocusSessionNew: vi.fn(),
  editorClearSessionFocus: vi.fn(),
  removePlaceholder: vi.fn(),
  setPlaceholderStatus: vi.fn(),
  sessionRanges: [{ text: 'A concise result', key: 'node-1', nodeKey: 'node-1' }] as unknown[],
  pendingReviews: [] as unknown[],
  settlePageReview: vi.fn(),
  reviewFailure: null as null | Record<string, unknown>,
  retryReview: vi.fn(),
  composer: {
    close: vi.fn(),
    continuationTarget: null as unknown,
    selectionVersion: 0,
    selection: null as unknown,
    setContinuationTarget: vi.fn(),
    draftHighlightVisible: true,
    setDraftHighlightVisible: vi.fn(),
  },
  composerListeners: new Set<() => void>(),
  editorUpdateListeners: new Set<() => void>(),
  currentImagePlaceholder: true,
  awareness: {
    users: [] as unknown[],
  },
  editorLifecycle: null as null | { editor: unknown; generation: number },
  hook: {
    error: undefined as Error | undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn().mockResolvedValue([]),
    requests: [] as unknown[],
  },
}));

const confirmModalMock = vi.hoisted(() => vi.fn());
const confirmModalSpy = vi.spyOn(BaseUI, 'confirmModal');

vi.mock('./rewriteRequests', () => {
  type MockRequest = {
    createdAt?: string;
    id: string;
    sessionId?: string | null;
    status: string;
    turnIndex?: number;
    updatedAt?: string;
  };

  const activeStatuses = new Set([
    'queued',
    'connecting',
    'syncing',
    'thinking',
    'writing',
    'cancel_requested',
    'retry_wait',
  ]);
  const compareRequests = (left: MockRequest, right: MockRequest) => {
    const turnDifference = (right.turnIndex ?? 1) - (left.turnIndex ?? 1);
    if (turnDifference !== 0) return turnDifference;
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  };

  return {
    getActivePageRewriteRequestIds: (requests: Array<{ id: string; status: string }>) =>
      requests.filter((item) => activeStatuses.has(item.status)).map((item) => item.id),
    getPageRewriteErrorMessage: (error: unknown, fallback: string) =>
      error instanceof Error && !error.message.startsWith('DOCUMENT_REWRITE_')
        ? error.message
        : fallback,
    normalizePageRewriteProgress: (value: unknown) => value ?? null,
    getRewriteQuotedText: (request: { selection?: { quotedText?: string } }) =>
      request.selection?.quotedText || '',
    groupPageRewriteRequests: (requests: MockRequest[]) => {
      const groups = new Map<
        string,
        { key: string; requests: MockRequest[]; sessionId: string | null }
      >();
      for (const item of requests) {
        const key = item.sessionId || item.id;
        const group = groups.get(key);
        if (group) group.requests.push(item);
        else groups.set(key, { key, requests: [item], sessionId: item.sessionId || null });
      }
      const grouped = [...groups.values()];
      grouped.forEach((group) => group.requests.sort(compareRequests));
      return grouped;
    },
    isPageRewriteActiveStatus: (status: string) => activeStatuses.has(status),
    getPageRewriteReviewFailure: () => mocks.reviewFailure,
    PAGE_REWRITE_MAX_ACTIVE_REQUESTS: 5,
    pageRewriteRequestClient: mocks.client,
    retryPageRewriteReview: mocks.retryReview,
    settlePageRewriteReview: mocks.settlePageReview,
    subscribePageRewriteReviewFailures: () => () => undefined,
    usePageRewriteRequests: () => mocks.hook,
  };
});

vi.mock('../rewriteComposerContext', () => ({
  usePageRewriteComposer: () =>
    useSyncExternalStore(
      (listener) => {
        mocks.composerListeners.add(listener);
        return () => mocks.composerListeners.delete(listener);
      },
      () => mocks.composer,
      () => mocks.composer,
    ),
}));

vi.mock('./AgentSelector/AgentSelectorAction', () => ({
  default: () => <span data-testid="rewrite-agent-action">Agent</span>,
}));

vi.mock('./imageRewrite', () => ({
  getDefaultImageModel: () => null,
  getBlockImagePlaceholderState: (_editor: unknown, selection: unknown) => {
    const nodeId =
      selection && typeof selection === 'object'
        ? (selection as Record<string, unknown>).targetNodeId
        : undefined;
    return nodeId === 'image-1'
      ? { placeholder: mocks.currentImagePlaceholder, src: '', status: 'error' }
      : null;
  },
  isBlockImageRewriteSelection: (selection: unknown) =>
    Boolean(
      selection &&
      typeof selection === 'object' &&
      (selection as Record<string, unknown>).adapterId === 'block-image' &&
      (selection as Record<string, unknown>).targetKind === 'node',
    ),
  isBlockImagePlaceholderSelection: (selection: unknown) =>
    Boolean(
      selection &&
      typeof selection === 'object' &&
      (selection as Record<string, unknown>).adapterId === 'block-image' &&
      (selection as Record<string, unknown>).targetKind === 'node' &&
      (selection as Record<string, unknown>).imagePlaceholder === true,
    ),
  removeBlockImagePlaceholder: mocks.removePlaceholder,
  isCurrentBlockImagePlaceholder: (_editor: unknown, selection: unknown) => {
    const nodeId =
      selection && typeof selection === 'object'
        ? (selection as Record<string, unknown>).targetNodeId
        : undefined;
    return nodeId === 'image-1' && mocks.currentImagePlaceholder;
  },
  isEnabledImageModel: () => false,
  setBlockImagePlaceholderStatus: mocks.setPlaceholderStatus,
}));

vi.mock('./CopilotModelSelect', () => ({
  default: () => <span data-testid="rewrite-model-action">Model</span>,
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

vi.mock('../PageEditorProvider', () => ({
  usePageEditorEditorLifecycle: () => mocks.editorLifecycle,
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => vi.fn(),
}));

vi.mock('../store', () => ({
  usePageEditorStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      documentId: 'page-1',
      editor: {
        focusAIProvenance: (...args: unknown[]) => mocks.editorFocusProvenance(...args),
        getLexicalEditor: () => ({
          registerUpdateListener: (listener: () => void) => {
            mocks.editorUpdateListeners.add(listener);
            return () => mocks.editorUpdateListeners.delete(listener);
          },
        }),
        requireService: () => ({
          subscribeAwarenessUsers: (listener: (users: unknown[]) => void) => {
            listener(mocks.awareness.users);
            return () => undefined;
          },
          listPendingReviews: () => mocks.pendingReviews,
          settleReview: (...args: unknown[]) => mocks.editorSettleReview(...args),
          clearSessionFocus: (...args: unknown[]) => mocks.editorClearSessionFocus(...args),
          focusSession: (...args: unknown[]) => mocks.editorFocusSession(...args),
          getRanges: () => mocks.sessionRanges,
          refresh: vi.fn(),
          subscribe: vi.fn(() => () => undefined),
          setHoveredSessionId: (...args: unknown[]) => mocks.editorHoveredSession(...args),
        }),
        setAIProvenanceHighlight: (...args: unknown[]) => mocks.editorHighlight(...args),
      },
    }),
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      agentMap: { 'agent-1': { id: 'agent-1', title: 'Agent One', type: 'agent' } },
      activeAgentId: 'agent-1',
      builtinAgentIdMap: {},
    }),
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

const request = (status: string, overrides: Record<string, unknown> = {}) => ({
  agentId: 'agent-1',
  attempt: 1,
  createdAt: '2026-08-29T00:00:00.000Z',
  documentId: 'page-1',
  id: `request-${status}`,
  instruction: 'Improve this sentence',
  selection: { quotedText: 'Selected text', startNodeId: 'node-1', targetNodeIds: ['node-1'] },
  lastCommandId:
    status === 'awaiting_review' || status === 'canceled_after_write' ? 'command-review' : null,
  status,
  updatedAt: '2026-08-29T00:00:00.000Z',
  ...overrides,
});

describe('AgentEditsPanel', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    confirmModalMock.mockReset();
    confirmModalSpy
      .mockReset()
      .mockImplementation(((options: unknown) =>
        confirmModalMock(options)) as typeof BaseUI.confirmModal);
    mocks.client.cancel.mockReset();
    mocks.client.create.mockReset();
    mocks.client.create.mockResolvedValue({ request: { id: 'request-created' } });
    mocks.client.continue.mockReset();
    mocks.client.review.mockReset();
    mocks.client.retry.mockReset();
    mocks.client.deleteSession.mockReset();
    mocks.editorSettleReview.mockReset();
    mocks.editorFocusProvenance.mockReset();
    mocks.editorHighlight.mockReset();
    mocks.editorHoveredSession.mockReset();
    mocks.editorFocusSession.mockReset();
    mocks.editorFocusSessionNew.mockReset();
    mocks.editorClearSessionFocus.mockReset();
    mocks.removePlaceholder.mockReset().mockReturnValue(true);
    mocks.setPlaceholderStatus.mockReset().mockReturnValue(true);
    mocks.editorSettleReview.mockResolvedValue({
      affectedNodeIds: ['node-1'],
      attempt: 1,
      commandId: 'command-review',
      requestId: 'request-awaiting_review',
      stateVector: 'proof-state-vector',
      status: 'applied',
    });
    mocks.pendingReviews = [];
    mocks.settlePageReview.mockReset().mockResolvedValue({ status: 'applied' });
    mocks.reviewFailure = null;
    mocks.retryReview.mockReset();
    mocks.hook.error = undefined;
    mocks.hook.isLoading = false;
    mocks.hook.isValidating = false;
    mocks.hook.mutate.mockReset().mockResolvedValue([]);
    mocks.hook.requests = [];
    mocks.composer.selection = null;
    mocks.composer.continuationTarget = null;
    mocks.composer.selectionVersion = 0;
    mocks.composer.setContinuationTarget.mockReset();
    mocks.composer.draftHighlightVisible = true;
    mocks.composer.setDraftHighlightVisible.mockReset();
    mocks.editorUpdateListeners.clear();
    mocks.currentImagePlaceholder = true;
    mocks.awareness.users = [];
    mocks.sessionRanges = [{ text: 'A concise result', key: 'node-1', nodeKey: 'node-1' }];
    mocks.editorLifecycle = null;
  });

  it('renders explicit loading, error, and empty states', () => {
    const { rerender } = render(<AgentEditsPanel />);
    expect(screen.getByText('copilot.rewrite.empty')).toBeInTheDocument();

    mocks.hook.isLoading = true;
    rerender(<AgentEditsPanel key="loading" />);
    expect(screen.getByText('copilot.rewrite.loading')).toBeInTheDocument();

    mocks.hook.isLoading = false;
    mocks.hook.error = new Error('DOCUMENT_REWRITE_REQUEST_NOT_FOUND');
    rerender(<AgentEditsPanel key="error" />);
    expect(screen.getByText('copilot.rewrite.loadError')).toBeInTheDocument();
  });

  it('shows cancel/retry controls by lifecycle state and reports mutation failures', async () => {
    mocks.hook.requests = [request('thinking'), request('failed')];
    mocks.client.cancel.mockRejectedValueOnce(new Error('DOCUMENT_REWRITE_REQUEST_CONFLICT'));
    mocks.client.retry.mockRejectedValueOnce(new Error('DOCUMENT_REWRITE_REQUEST_CONFLICT'));
    render(<AgentEditsPanel />);

    expect(screen.getByRole('button', { name: 'copilot.rewrite.cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copilot.rewrite.retry' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.cancel' }));
    await waitFor(() =>
      expect(screen.getByText('copilot.rewrite.actionError')).toBeInTheDocument(),
    );
    expect(mocks.client.cancel).toHaveBeenCalledWith({ attempt: 1, id: 'request-thinking' });

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.retry' }));
    await waitFor(() =>
      expect(mocks.client.retry).toHaveBeenCalledWith({ attempt: 1, id: 'request-failed' }),
    );
  });

  it('offers removal for a failed empty image placeholder and removes only that target', async () => {
    const placeholderSelection = {
      adapterId: 'block-image',
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    const failedRequest = request('failed', { selection: placeholderSelection });
    mocks.hook.requests = [failedRequest];
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.removePlaceholder' }));

    await waitFor(() =>
      expect(mocks.removePlaceholder).toHaveBeenCalledWith(expect.anything(), placeholderSelection),
    );
    expect(mocks.composer.setContinuationTarget).toHaveBeenCalledWith(null);
    expect(mocks.hook.mutate).toHaveBeenCalled();
  });

  it('hides placeholder actions when the authoritative image receives a source later', async () => {
    const normalizedSelection = {
      adapterId: 'block-image',
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    mocks.hook.requests = [request('failed', { selection: normalizedSelection })];
    render(<AgentEditsPanel />);

    expect(
      screen.getByRole('button', { name: 'copilot.rewrite.removePlaceholder' }),
    ).toBeInTheDocument();
    mocks.currentImagePlaceholder = false;
    act(() => {
      mocks.editorUpdateListeners.forEach((listener) => listener());
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'copilot.rewrite.removePlaceholder' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('marks an image placeholder loading for retry and restores error when retry fails', async () => {
    const placeholderSelection = {
      adapterId: 'block-image',
      targetKind: 'node',
      targetNodeId: 'image-1',
    };
    const failedRequest = request('failed', { selection: placeholderSelection });
    mocks.hook.requests = [failedRequest];
    mocks.client.retry.mockRejectedValueOnce(new Error('retry unavailable'));
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.retry' }));

    await waitFor(() =>
      expect(mocks.client.retry).toHaveBeenCalledWith({ attempt: 1, id: failedRequest.id }),
    );
    await waitFor(() =>
      expect(mocks.setPlaceholderStatus).toHaveBeenLastCalledWith(
        expect.anything(),
        placeholderSelection,
        'error',
      ),
    );
    expect(mocks.setPlaceholderStatus).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      placeholderSelection,
      'loading',
    );
    expect(screen.getByText('retry unavailable')).toBeInTheDocument();
  });

  it('does not offer cancel after the server has accepted a cancellation request', () => {
    mocks.hook.requests = [request('cancel_requested')];
    render(<AgentEditsPanel />);

    expect(
      screen.queryByRole('button', { name: 'copilot.rewrite.cancel' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('cancel_requested')).toBeInTheDocument();
  });

  it('shows applied edits with one success status and without the old selection preview', () => {
    mocks.hook.requests = [
      request('applied', {
        errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR',
        errorMessage: 'stale retry failure',
        outputText: 'A concise result',
        sessionId: 'rws_session-1',
        turnIndex: 1,
      }),
    ];
    render(<AgentEditsPanel />);

    expect(screen.queryByRole('button', { name: 'modifier.accept' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'modifier.reject' })).not.toBeInTheDocument();
    expect(screen.getByText('applied')).toBeInTheDocument();
    expect(screen.queryByText('copilot.rewrite.appliedDirectly')).not.toBeInTheDocument();
    expect(screen.queryByText('Selected text')).not.toBeInTheDocument();
    expect(document.querySelector('[data-rewrite-original-selection]')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('collapses session rounds into one card and reveals history with an accessible toggle', () => {
    mocks.hook.requests = [
      request('applied', {
        id: 'request-round-one',
        instruction: 'Make it clear',
        outputText: 'A clear result',
        sessionId: 'rws_session-1',
        turnIndex: 1,
      }),
      request('failed', {
        errorMessage: 'generation failed',
        id: 'request-round-two',
        instruction: 'Make it shorter',
        sessionId: 'rws_session-1',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:02.000Z',
      }),
    ];
    render(<AgentEditsPanel />);

    expect(document.querySelectorAll('[data-rewrite-session-key="rws_session-1"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-rewrite-request-id]')).toHaveLength(1);
    expect(screen.getByText('copilot.rewrite.lastApplied')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'copilot.rewrite.showHistory' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.showHistory' }));

    expect(screen.getByRole('button', { name: 'copilot.rewrite.hideHistory' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(
      document.querySelector('[data-rewrite-request-id="request-round-one"]'),
    ).toBeInTheDocument();
  });

  it('keeps retry on a failed latest round and continuation anchored to the last applied round', () => {
    mocks.hook.requests = [
      request('applied', {
        id: 'request-round-one',
        outputText: 'A concise result',
        sessionId: 'rws_session-1',
        turnIndex: 1,
      }),
      request('failed', {
        errorMessage: 'generation failed',
        id: 'request-round-two',
        sessionId: 'rws_session-1',
        turnIndex: 2,
        updatedAt: '2026-08-29T00:00:02.000Z',
      }),
    ];
    render(<AgentEditsPanel />);

    expect(screen.getByRole('button', { name: 'copilot.rewrite.retry' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
    expect(screen.getByText('copilot.rewrite.lastApplied')).toBeInTheDocument();
  });

  it('does not offer an old continuation while a newer round is writing, including history', () => {
    mocks.hook.requests = [
      request('applied', {
        id: 'previous-round',
        outputText: 'A concise result',
        sessionId: 'rws_running',
        turnIndex: 1,
      }),
      request('writing', {
        id: 'current-round',
        sessionId: 'rws_running',
        turnIndex: 2,
      }),
    ];
    const { rerender } = render(<AgentEditsPanel />);
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.showHistory' }));
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();

    mocks.hook.requests = [
      request('applied', {
        id: 'current-round',
        sessionId: 'rws_running',
        turnIndex: 2,
        outputText: 'A concise result',
      }),
    ];
    rerender(<AgentEditsPanel key="completed-round" />);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('offers continuation only for an applied request with a durable session output', async () => {
    const originalContext = 'S的啊是的啊是';
    const generatedOutput = 'function quickSort(items) { return items; }';
    const firstTurn = request('applied', {
      id: 'request-first',
      outputText: 'first output',
      selection: { quotedText: originalContext, startNodeId: 'node-1', targetNodeIds: ['node-1'] },
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    const applied = request('applied', {
      outputText: generatedOutput,
      selection: {
        quotedText: generatedOutput,
        startNodeId: 'node-1',
        targetNodeIds: ['node-1'],
      },
      sessionId: 'rws_session-1',
      turnIndex: 2,
    });
    mocks.hook.requests = [firstTurn, applied];
    mocks.sessionRanges = [
      {
        text: generatedOutput,
        key: 'node-1',
        nodeKey: 'node-1',
      },
    ];
    render(<AgentEditsPanel />);
    const clearFocusCallsBeforeSubmit = mocks.editorClearSessionFocus.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mocks.editorFocusSession).not.toHaveBeenCalled();
    expect(screen.getByText('Continuing this session')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder')).toHaveFocus(),
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'data-page-rewrite-selection-count',
      `${Array.from(originalContext).length}`,
    );
    expect(screen.getByText(originalContext)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Make it warmer' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Continue' }).at(0)!);
    await waitFor(() =>
      expect(mocks.client.continue).toHaveBeenCalledWith({
        instruction: 'Make it warmer',
        model: 'model-1',
        parentRequestId: applied.id,
        provider: 'provider-1',
      }),
    );
    expect(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder')).toHaveValue('');
    expect(mocks.editorClearSessionFocus.mock.calls.length).toBeGreaterThan(
      clearFocusCallsBeforeSubmit,
    );
  });

  it('highlights a continuation draft, then hides the highlight without discarding its context', async () => {
    const applied = request('applied', {
      outputText: 'A concise result',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    mocks.hook.requests = [applied];
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mocks.composer.setDraftHighlightVisible).toHaveBeenCalledWith(true);
    expect(mocks.composer.setContinuationTarget).toHaveBeenCalledWith({
      outputText: 'A concise result',
      requestId: applied.id,
      selection: applied.selection,
      sessionId: 'rws_session-1',
    });

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Make it warmer' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Continue' }).at(0)!);
    await waitFor(() => expect(mocks.client.continue).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.composer.setDraftHighlightVisible).toHaveBeenCalledWith(false),
    );
    expect(mocks.editorHoveredSession).toHaveBeenLastCalledWith(null);
    expect(mocks.composer.setContinuationTarget).not.toHaveBeenLastCalledWith(null);
    expect(screen.getByText('Continuing this session')).toBeInTheDocument();
  });

  it('atomically replaces an open continuation with a newly captured selection', async () => {
    const applied = request('applied', {
      outputText: 'A concise result',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    mocks.hook.requests = [applied];
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Continuing this session')).toBeInTheDocument();

    mocks.composer = {
      ...mocks.composer,
      selectionVersion: 1,
      selection: {
        endNodeId: 'node-new-end',
        endOffset: 4,
        kind: 'block',
        quotedText: 'New selected text',
        quotedTextHash: 'new-selection-hash',
        startNodeId: 'node-new-start',
        startOffset: 1,
        targetNodeIds: ['node-new-start', 'node-new-end'],
      },
    };
    mocks.composerListeners.forEach((listener) => listener());

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'copilot.rewrite.submit' })).toBeInTheDocument();
      expect(screen.getByText('New selected text')).toBeInTheDocument();
    });
    expect(screen.queryByText('Continuing this session')).not.toBeInTheDocument();
    expect(mocks.composer.setContinuationTarget).toHaveBeenLastCalledWith(null);
    expect(mocks.editorClearSessionFocus).toHaveBeenCalled();
  });

  it('starts a fresh draft when a new selection replaces a submitted rewrite', async () => {
    const firstSelection = {
      endNodeId: 'node-old-end',
      endOffset: 8,
      kind: 'block',
      quotedText: 'Old selected text',
      quotedTextHash: 'old-selection-hash',
      startNodeId: 'node-old-start',
      startOffset: 0,
      targetNodeIds: ['node-old-start', 'node-old-end'],
    };
    const nextSelection = {
      ...firstSelection,
      endNodeId: 'node-new-end',
      quotedText: 'New selected text',
      quotedTextHash: 'new-selection-hash',
      startNodeId: 'node-new-start',
      targetNodeIds: ['node-new-start', 'node-new-end'],
    };
    const firstRequest = request('thinking', {
      createdAt: '2026-08-29T00:00:01.000Z',
      id: 'request-first-draft',
      instruction: 'Initial rewrite instruction',
      selection: firstSelection,
      sessionId: 'rws_first-draft',
    });
    const nextRequest = request('thinking', {
      createdAt: '2026-08-29T00:00:02.000Z',
      id: 'request-next-draft',
      instruction: 'Next rewrite instruction',
      selection: firstSelection,
      sessionId: 'rws_next-draft',
    });
    mocks.hook.requests = [firstRequest];
    mocks.hook.mutate.mockImplementation(async () => {
      mocks.hook.requests = [firstRequest, nextRequest];
      return mocks.hook.requests;
    });
    mocks.composer.selection = firstSelection;
    render(<AgentEditsPanel />);

    fireEvent.change(screen.getByPlaceholderText('copilot.rewrite.instructionPlaceholder'), {
      target: { value: 'Initial rewrite instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.submit' }));
    await waitFor(() =>
      expect(screen.getByText('Initial rewrite instruction')).toBeInTheDocument(),
    );
    expect(mocks.composer.setDraftHighlightVisible).toHaveBeenCalledWith(false);

    mocks.composer = {
      ...mocks.composer,
      selection: nextSelection,
      selectionVersion: 1,
    };
    mocks.composerListeners.forEach((listener) => listener());

    await waitFor(() => expect(screen.getByText('New selected text')).toBeInTheDocument());
    expect(screen.queryByText('Initial rewrite instruction')).not.toBeInTheDocument();
    expect(screen.queryByText('Next rewrite instruction')).not.toBeInTheDocument();
  });

  it('returns from continuation detail to the Agent edit list without deleting history', () => {
    const applied = request('applied', {
      outputText: 'A concise result',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    mocks.hook.requests = [applied];
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to Agent edits' }));

    expect(screen.getByTestId('page-rewrite-active-count')).toBeInTheDocument();
    expect(
      document.querySelector('[data-rewrite-request-id="request-applied"]'),
    ).toBeInTheDocument();
    expect(mocks.composer.setContinuationTarget).toHaveBeenLastCalledWith(null);
    expect(mocks.editorClearSessionFocus).toHaveBeenCalled();
  });

  it('restores continuation navigation without persistent focus after an editor reset', async () => {
    const applied = request('applied', {
      outputText: 'A concise result',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    mocks.hook.requests = [applied];
    const newService = {
      clearSessionFocus: vi.fn(),
      focusSession: mocks.editorFocusSessionNew,
      getRanges: vi.fn(() => mocks.sessionRanges),
      refresh: vi.fn(),
      setHoveredSessionId: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      subscribeAwarenessUsers: (listener: (users: unknown[]) => void) => {
        listener([]);
        return () => undefined;
      },
    };
    const newEditor = {
      getRootElement: () => null,
      requireService: () => newService,
    };
    mocks.editorLifecycle = { editor: newEditor, generation: 2 };
    render(<AgentEditsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(mocks.editorFocusSessionNew).not.toHaveBeenCalled();
    expect(newService.clearSessionFocus).toHaveBeenCalled();
  });

  it('keeps card hover feedback but does not leave active focus after navigation', () => {
    const applied = request('applied', {
      outputText: 'A concise result',
      sessionId: 'rws_session-1',
      turnIndex: 1,
    });
    mocks.hook.requests = [applied];
    render(<AgentEditsPanel />);
    const card = document.querySelector('[data-rewrite-request-id="request-applied"]');
    expect(card).toHaveAttribute('data-ai-session-id', 'rws_session-1');
    fireEvent.mouseEnter(card!);
    expect(mocks.editorHoveredSession).toHaveBeenCalledWith('rws_session-1');
    fireEvent.mouseLeave(card!);
    expect(mocks.editorHoveredSession).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.viewAnchor' }));
    expect(mocks.editorFocusSession).not.toHaveBeenCalled();
    expect(mocks.editorClearSessionFocus).toHaveBeenCalled();
  });

  it('keeps the cancel-after-write warning on an applied request', () => {
    mocks.hook.requests = [
      request('applied', {
        errorCode: 'CANCELED_AFTER_WRITE',
        errorMessage: 'Cancellation arrived after the direct rewrite was written',
      }),
    ];
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByText('copilot.rewrite.showDetails'));
    expect(screen.getByRole('alert')).toHaveTextContent('copilot.rewrite.actionError');
  });

  it('keeps retryable original selections inside collapsed error details', () => {
    mocks.hook.requests = [
      request('thinking'),
      request('failed'),
      request('retry_wait'),
      request('stale'),
    ];
    render(<AgentEditsPanel />);

    expect(screen.getAllByText('copilot.rewrite.showDetails')).toHaveLength(3);
    expect(document.querySelectorAll('[data-rewrite-details]:not([open])')).toHaveLength(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-rewrite-request-id="request-thinking"]'),
    ).not.toHaveTextContent('Selected text');

    const firstDetails = document.querySelector('[data-rewrite-details]')!;
    fireEvent.click(screen.getAllByText('copilot.rewrite.showDetails')[0]!);
    expect(firstDetails).toHaveAttribute('open');
    expect(
      within(firstDetails as HTMLElement).getByText('copilot.rewrite.originalSelection'),
    ).toBeInTheDocument();
    expect(within(firstDetails as HTMLElement).getByText('Selected text')).toBeInTheDocument();
  });

  it('does not render round metadata for a single legacy request', () => {
    mocks.hook.requests = [request('applied')];
    render(<AgentEditsPanel />);

    expect(screen.queryByText('copilot.rewrite.sessionRounds')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'copilot.rewrite.showHistory' }),
    ).not.toBeInTheDocument();
  });

  it('confirms, cancels, and completes terminal session deletion without editing document content', async () => {
    mocks.hook.requests = [
      request('applied', {
        outputText: 'A concise result',
        sessionId: 'rws_session-1',
      }),
    ];
    mocks.client.deleteSession.mockResolvedValueOnce({
      deletedCount: 1,
      documentId: 'page-1',
      requestId: 'request-applied',
      sessionId: 'rws_session-1',
    });
    confirmModalMock.mockImplementation(() => undefined);
    render(<AgentEditsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'copilot.rewrite.more' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'copilot.rewrite.delete' }));

    const config = confirmModalMock.mock.calls[0]?.[0] as {
      content: string;
      onOk: () => Promise<void>;
      title: string;
    };
    expect(config.title).toBe('copilot.rewrite.deleteConfirmTitle');
    expect(config.content).toBe('copilot.rewrite.deleteConfirmContent');
    expect(mocks.client.deleteSession).not.toHaveBeenCalled();

    await config.onOk();
    expect(mocks.client.deleteSession).toHaveBeenCalledWith({
      documentId: 'page-1',
      requestId: 'request-applied',
    });
    expect(mocks.hook.mutate).toHaveBeenCalled();
  });

  it('counts active requests independently and releases a slot after completion', () => {
    mocks.hook.requests = [
      request('queued'),
      request('connecting'),
      request('thinking'),
      request('writing'),
      request('retry_wait'),
      request('applied'),
    ];
    const { rerender } = render(<AgentEditsPanel />);

    const summary = screen.getByTestId('page-rewrite-active-count');
    expect(summary).toHaveAttribute('data-active-count', '5');

    mocks.hook.requests = [
      request('queued'),
      request('connecting'),
      request('thinking'),
      request('applied'),
    ];
    rerender(<AgentEditsPanel key="released" />);
    expect(screen.getByTestId('page-rewrite-active-count')).toHaveAttribute(
      'data-active-count',
      '3',
    );
  });

  it('merges awareness activity with request state without double-counting a request', async () => {
    mocks.hook.requests = [request('thinking'), request('writing'), request('applied')];
    mocks.awareness.users = [
      {
        clientId: 42,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'page-1',
            requestId: 'request-thinking',
            role: 'agent',
            status: 'thinking',
          },
          color: '#7c3aed',
          focusPos: null,
          focusing: true,
          name: 'Rewrite Agent',
        },
      },
      {
        clientId: 43,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'page-1',
            requestId: 'request-awareness-only',
            role: 'agent',
            status: 'writing',
          },
          color: '#2563eb',
          focusPos: null,
          focusing: true,
          name: 'Second Rewrite Agent',
        },
      },
    ];
    render(<AgentEditsPanel />);

    await waitFor(() =>
      expect(screen.getByTestId('page-rewrite-active-count')).toHaveAttribute(
        'data-active-count',
        '3',
      ),
    );
  });

  it('renders Agent awareness name, color, and live status from the Yjs service', () => {
    mocks.awareness.users = [
      {
        clientId: 42,
        state: {
          anchorPos: null,
          awarenessData: {
            documentId: 'page-1',
            requestId: 'request-1',
            role: 'agent',
            status: 'thinking',
          },
          color: '#7c3aed',
          focusPos: null,
          focusing: true,
          name: 'Rewrite Agent',
        },
      },
    ];
    render(<AgentEditsPanel />);

    expect(screen.getByText('Rewrite Agent')).toBeInTheDocument();
    const status = screen.getByText('thinking');
    expect(status).toBeInTheDocument();
    expect(document.querySelector('[data-agent-awareness] [aria-hidden="true"]')).toHaveAttribute(
      'style',
      expect.stringContaining('7c3aed'),
    );
  });
});
