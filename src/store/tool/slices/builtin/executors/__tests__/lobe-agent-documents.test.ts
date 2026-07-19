import type { BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { takeWorkIntent } from '@/utils/clientWorkIntentStash';

import { agentDocumentsExecutor } from '../lobe-agent-documents';

const mocks = vi.hoisted(() => ({
  copyDocument: vi.fn(),
  createDocument: vi.fn(),
  createForTopic: vi.fn(),
  listDocuments: vi.fn(),
  modifyNodes: vi.fn(),
  readDocument: vi.fn(),
  refreshConversation: vi.fn(),
  removeDocument: vi.fn(),
  renameDocument: vi.fn(),
  replaceDocumentContent: vi.fn(),
  updateLoadRule: vi.fn(),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: vi.fn(),
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    copyDocument: mocks.copyDocument,
    createDocument: mocks.createDocument,
    createForTopic: mocks.createForTopic,
    listDocuments: mocks.listDocuments,
    modifyNodes: mocks.modifyNodes,
    readDocument: mocks.readDocument,
    removeDocument: mocks.removeDocument,
    renameDocument: mocks.renameDocument,
    replaceDocumentContent: mocks.replaceDocumentContent,
    updateLoadRule: mocks.updateLoadRule,
  },
}));

vi.mock('@/services/work', () => ({
  workService: {
    refreshConversation: mocks.refreshConversation,
  },
}));

describe('agentDocumentsExecutor', () => {
  const createContext = (overrides?: Partial<BuiltinToolContext>): BuiltinToolContext => ({
    agentId: 'agent-1',
    messageId: 'tool-context-key',
    operationId: 'operation-1',
    rootOperationId: 'root-operation-1',
    sourceMessageId: 'user-message-1',
    threadId: 'thread-1',
    toolCallId: 'tool-call-1',
    toolMessageId: 'tool-message-1',
    topicId: 'topic-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshConversation.mockResolvedValue(undefined);
    // Drain any leftover so the shared per-toolCallId stash starts clean.
    takeWorkIntent('tool-call-1');
  });

  it('stashes a document register intent after attributed document creation', async () => {
    mocks.createDocument.mockResolvedValue({
      description: 'A daily brief',
      documentId: 'document-1',
      id: 'agent-document-1',
      title: 'Test Document',
    });

    const result = await agentDocumentsExecutor.invoke(
      'createDocument',
      {
        content: 'Body',
        title: 'Test Document',
      },
      createContext(),
    );

    expect(result.success).toBe(true);
    expect(mocks.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        content: 'Body',
        title: 'Test Document',
        toolContext: expect.objectContaining({
          messageId: 'user-message-1',
          rootOperationId: 'root-operation-1',
          threadId: 'thread-1',
          toolCallId: 'tool-call-1',
          toolMessageId: 'tool-message-1',
          topicId: 'topic-1',
        }),
        trigger: 'tool',
      }),
    );

    // The wrapper no longer refreshes inline; it stashes the register intent for
    // `call_tool` to write once cost is known.
    expect(mocks.refreshConversation).not.toHaveBeenCalled();
    expect(takeWorkIntent('tool-call-1')).toEqual(
      expect.objectContaining({
        action: 'register',
        document: expect.objectContaining({
          agentDocumentId: 'agent-document-1',
          agentId: 'agent-1',
          description: 'A daily brief',
          documentId: 'document-1',
          changeType: 'created',
          toolName: 'createDocument',
        }),
        type: 'document',
      }),
    );
  });
});
