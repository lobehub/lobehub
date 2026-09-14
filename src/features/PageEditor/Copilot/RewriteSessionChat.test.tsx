import type { UIChatMessage } from '@lobechat/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PageRewriteRequest } from './rewriteRequests';
import { pageRewriteRequestClient } from './rewriteRequests';
import {
  RewriteSessionMessage,
  toRewriteSessionMessages,
  toTopicRewriteMessages,
} from './RewriteSessionChat';

vi.mock('@/features/Conversation/ChatItem', () => ({
  ChatItem: ({ message, messageExtra, loading }: any) => (
    <div data-loading={String(loading)} data-testid="chat-item">
      {message}
      {messageExtra}
    </div>
  ),
}));
vi.mock('@/store/agent', () => ({ useAgentStore: () => undefined }));
const setDraftHighlightVisible = vi.hoisted(() => vi.fn());
vi.mock('../rewriteComposerContext', () => ({
  usePageRewriteComposer: () => ({ setDraftHighlightVisible }),
}));
vi.mock('@/components/NeuralNetworkLoading', () => ({
  default: () => <span data-testid="generation-loading" />,
}));
afterEach(cleanup);

describe('rewrite terminal presentation', () => {
  it('clears the draft hint on retry and recovers the action after a failed submission', async () => {
    const retry = vi
      .spyOn(pageRewriteRequestClient, 'retry')
      .mockRejectedValue(new Error('offline'));
    const output = toRewriteSessionMessages([
      { ...request, status: 'failed', errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty' },
    ])[2];
    render(<RewriteSessionMessage {...output} />);
    fireEvent.click(screen.getByRole('button', { name: /retry|重试|copilot.rewrite.retry/i }));
    expect(setDraftHighlightVisible).toHaveBeenCalledWith(false);
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /retry|重试|copilot.rewrite.retry/i }),
      ).toBeEnabled(),
    );
    expect(retry).toHaveBeenCalledWith({ id: request.id, attempt: request.attempt });
    retry.mockRestore();
  });
  it('a failed request overrides stale loading, has one error, and offers retry', () => {
    const failed = {
      ...request,
      status: 'failed' as const,
      errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty',
      errorMessage: 'Document rewrite model generation failed',
      progress: {
        currentStage: 'generating_replacement' as const,
        events: [{ stage: 'generating_replacement' as const, at: request.createdAt }],
        updatedAt: request.updatedAt,
      },
    };
    const output = toRewriteSessionMessages([failed])[2];
    render(<RewriteSessionMessage {...output} loading />);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByTestId('chat-item')).toHaveAttribute('data-loading', 'false');
    expect(screen.queryByTestId('generation-loading')).toBeNull();
    expect(
      screen.getByRole('button', { name: /retry|重试|copilot.rewrite.retry/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Document rewrite model generation failed')).toBeNull();
  });
  it('an automatic retry remains active without resurfacing the last attempt error', () => {
    const output = toRewriteSessionMessages([
      { ...request, status: 'retry_wait', errorMessage: 'old failure' },
    ])[2];
    render(<RewriteSessionMessage {...output} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('chat-item')).toHaveAttribute('data-loading', 'true');
  });
});

const request = {
  agentId: 'agent-1',
  attempt: 1,
  createdAt: '2026-09-04T00:00:00.000Z',
  documentId: 'page-1',
  id: 'request-1',
  instruction: 'Make it concise',
  progress: null,
  provider: 'provider-1',
  model: 'model-1',
  selection: { quotedText: 'Selected text' },
  sessionId: 'session-1',
  status: 'applied',
  topicId: 'topic-1',
  turnIndex: 1,
  updatedAt: '2026-09-04T00:00:01.000Z',
} satisfies PageRewriteRequest;

const message = (
  overrides: Partial<UIChatMessage> & Pick<UIChatMessage, 'id' | 'role' | 'content'>,
): UIChatMessage =>
  ({
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  }) as UIChatMessage;

describe('toTopicRewriteMessages', () => {
  it('projects terminal failure only on the assistant and removes the pending placeholder', () => {
    const failed = {
      ...request,
      status: 'failed' as const,
      errorCode: 'DOCUMENT_REWRITE_PRODUCTION_MODEL_ERROR:empty',
      errorMessage: 'Document rewrite model generation failed',
    };
    const projected = toTopicRewriteMessages(
      [
        message({
          id: 'u',
          role: 'user',
          content: failed.instruction,
          metadata: { requestId: failed.id } as never,
        }),
        message({
          id: 'a',
          role: 'assistant',
          content: '...',
          metadata: { requestId: failed.id, status: 'connecting' } as never,
        }),
      ],
      [failed],
    );
    expect(projected[1].extra).not.toHaveProperty('errorMessage');
    expect(projected[1].extra).not.toHaveProperty('status');
    expect(projected[2].content).toBe('');
    expect(projected[2].extra).toMatchObject({ status: 'failed', errorCode: failed.errorCode });
  });
  it('uses the durable topic transcript and projects request progress onto assistant bubbles', () => {
    const result = toTopicRewriteMessages(
      [
        message({
          content: request.instruction,
          id: 'document-rewrite-request-1-user',
          metadata: { requestId: request.id, scope: 'document_rewrite' } as never,
          role: 'user',
        }),
        message({
          content: '<main>result</main>',
          id: 'document-rewrite-request-1-assistant',
          metadata: { requestId: request.id, scope: 'document_rewrite' } as never,
          role: 'assistant',
        }),
        message({
          content: '{"source":"private tool payload"}',
          id: 'tool-1',
          role: 'tool',
        }),
      ],
      [request],
      { id: 'session-1', text: 'Selected text' },
    );

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.role)).toEqual(['assistant', 'user', 'assistant']);
    expect(result[0]?.content).toBe('Selected text');
    expect(result[1]?.content).toBe(request.instruction);
    expect(result[2]?.content).toBe('<main>result</main>');
    expect(result[2]?.extra).toMatchObject({
      agentId: 'agent-1',
      kind: 'output',
      progress: null,
      status: 'applied',
    });
    expect(JSON.stringify(result)).not.toContain('private tool payload');
  });

  it('projects the human instruction instead of the enriched internal topic envelope', () => {
    const internalSource = '<script>window.gameState = { score: 10 }</script>';
    const result = toTopicRewriteMessages(
      [
        message({
          content: `<document_rewrite_turn>\n<authorized_rewrite_instruction>${request.instruction}</authorized_rewrite_instruction>\n<selected_target_context><source>${internalSource}</source></selected_target_context>\n</document_rewrite_turn>`,
          id: 'document-rewrite-request-1-user',
          metadata: { requestId: request.id, scope: 'document_rewrite' } as never,
          role: 'user',
        }),
        message({
          content: 'Model output',
          id: 'document-rewrite-request-1-assistant',
          metadata: { requestId: request.id, scope: 'document_rewrite' } as never,
          role: 'assistant',
        }),
      ],
      [request],
      { id: 'session-1', text: 'Artifact card' },
    );

    expect(result[0]?.content).toBe('Artifact card');
    expect(result[1]?.content).toBe(request.instruction);
    expect(result[1]?.content).not.toContain('document_rewrite_turn');
    expect(result[1]?.content).not.toContain(internalSource);
    expect(result[2]?.content).toBe('Model output');
  });
});

describe('toRewriteSessionMessages', () => {
  it('keeps the first selected context while showing each turn output in history', () => {
    const original = 'S的啊是的啊是';
    const firstTurn = {
      ...request,
      outputText: 'function quickSort(items) { return items; }',
      selection: { quotedText: original },
      turnIndex: 1,
    };
    const secondTurn = {
      ...request,
      id: 'request-2',
      instruction: 'Add a test',
      outputText: 'quickSort test output',
      selection: { quotedText: original },
      turnIndex: 2,
    };

    const result = toRewriteSessionMessages([secondTurn, firstTurn], {
      id: 'session-1',
      text: original,
    });

    expect(result[0]?.content).toBe(original);
    expect(
      result.filter((item) => item.extra?.kind === 'output').map((item) => item.content),
    ).toEqual([firstTurn.outputText, secondTurn.outputText]);
    expect(result[0]?.content).not.toBe(firstTurn.outputText);
  });
});
