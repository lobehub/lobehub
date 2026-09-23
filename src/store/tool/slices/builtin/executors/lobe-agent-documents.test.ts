import { AgentDocumentsApiName } from '@lobechat/builtin-tool-agent-documents';
import type { ToolAfterCallContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invalidateSpy, getDocumentStoreStateSpy } = vi.hoisted(() => ({
  getDocumentStoreStateSpy: vi.fn(),
  invalidateSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: invalidateSpy,
}));
vi.mock('@/store/document', () => ({
  getDocumentStoreState: getDocumentStoreStateSpy,
}));
vi.mock('@/services/agentDocument', () => ({ agentDocumentService: {} }));
vi.mock('@/services/work', () => ({ workService: {} }));
vi.mock('@/store/agent', () => ({
  useAgentStore: { getState: () => ({ activeAgentId: 'agent-1' }) },
}));
vi.mock('@/store/electron', () => ({ useElectronStore: { getState: () => ({}) } }));
vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  getActiveWorkspaceSlug: () => undefined,
}));

const afterCall = (apiName: string, documentId: string): ToolAfterCallContext =>
  ({
    apiName,
    identifier: 'lobe-agent-documents',
    params: {},
    result: { state: { documentId }, success: true },
    toolCallId: 'call_1',
  }) as ToolAfterCallContext;

describe('agentDocumentsExecutor host invalidation', () => {
  beforeEach(() => {
    invalidateSpy.mockClear();
    getDocumentStoreStateSpy.mockClear();
  });

  it('revalidates the editor key after a content write instead of touching the document store', async () => {
    const { agentDocumentsExecutor } = await import('./lobe-agent-documents');

    await agentDocumentsExecutor.onAfterCall!(
      afterCall(AgentDocumentsApiName.replaceDocumentContent, 'doc-1'),
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      agentId: 'agent-1',
      cause: 'agent-document',
      documentId: 'doc-1',
    });
    expect(getDocumentStoreStateSpy).not.toHaveBeenCalled();
  });

  it('does not revalidate the editor key of a removed document', async () => {
    const { agentDocumentsExecutor } = await import('./lobe-agent-documents');

    await agentDocumentsExecutor.onAfterCall!(
      afterCall(AgentDocumentsApiName.removeDocument, 'doc-1'),
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      agentId: 'agent-1',
      cause: 'agent-document',
      documentId: undefined,
    });
  });
});
