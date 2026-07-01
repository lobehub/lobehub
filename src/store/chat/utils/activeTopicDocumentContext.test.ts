import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentDocumentService } from '@/services/agentDocument';

import {
  mergeAgentRuntimeInitialContexts,
  resolveActiveTopicDocumentInitialContext,
} from './activeTopicDocumentContext';

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: {
    listDocuments: vi.fn(),
    readDocument: vi.fn(),
  },
}));

describe('activeTopicDocumentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentDocumentService.readDocument).mockResolvedValue(undefined);
  });

  it('resolves active topic document context from current topic documents', async () => {
    vi.mocked(agentDocumentService.listDocuments).mockResolvedValue([
      {
        documentId: 'docs_1',
        filename: 'doc-1.md',
        id: 'agd_1',
        title: 'Doc 1',
      },
    ] as any);

    const context = await resolveActiveTopicDocumentInitialContext({
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'main',
      topicId: 'tpc_1',
    });

    expect(agentDocumentService.listDocuments).toHaveBeenCalledWith({
      agentId: 'agt_1',
      scope: 'currentTopic',
      topicId: 'tpc_1',
    });
    expect(context?.initialContext?.activeTopicDocument).toEqual({
      agentDocumentId: 'agd_1',
      documentId: 'docs_1',
      title: 'Doc 1',
    });
  });

  it('short-circuits the reverse lookup when context carries agentDocumentId', async () => {
    const context = await resolveActiveTopicDocumentInitialContext({
      agentDocumentId: 'agd_caller',
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'thread',
      topicId: 'tpc_1',
    });

    expect(agentDocumentService.listDocuments).not.toHaveBeenCalled();
    expect(context?.initialContext?.activeTopicDocument).toEqual({
      agentDocumentId: 'agd_caller',
      documentId: 'docs_1',
    });
  });

  it('hydrates a send-time snapshot when the caller supplies agentDocumentId', async () => {
    vi.mocked(agentDocumentService.readDocument).mockResolvedValue({
      content: '# Plan\n\nCurrent body',
      contentCharCount: 20,
      litexml: '<doc><heading id="h1">Plan</heading></doc>',
      title: 'Plan',
    } as any);

    const context = await resolveActiveTopicDocumentInitialContext({
      agentDocumentId: 'agd_caller',
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'main',
      topicId: 'tpc_1',
    });

    expect(agentDocumentService.readDocument).toHaveBeenCalledWith({
      agentId: 'agt_1',
      format: 'both',
      id: 'agd_caller',
    });
    expect(context?.initialContext?.activeTopicDocument).toEqual({
      agentDocumentId: 'agd_caller',
      documentId: 'docs_1',
      snapshot: {
        markdown: '# Plan\n\nCurrent body',
        metadata: {
          charCount: 20,
          lineCount: 3,
          title: 'Plan',
        },
        xml: '<doc><heading id="h1">Plan</heading></doc>',
      },
      title: 'Plan',
    });
  });

  it('resolves with caller-supplied agentDocumentId even without an active topic', async () => {
    const context = await resolveActiveTopicDocumentInitialContext({
      agentDocumentId: 'agd_caller',
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'thread',
    });

    expect(agentDocumentService.listDocuments).not.toHaveBeenCalled();
    expect(context?.initialContext?.activeTopicDocument).toEqual({
      agentDocumentId: 'agd_caller',
      documentId: 'docs_1',
    });
  });

  it('does not resolve active topic document context in page scope', async () => {
    const context = await resolveActiveTopicDocumentInitialContext({
      agentId: 'agt_1',
      documentId: 'docs_1',
      scope: 'page',
      topicId: 'tpc_1',
    });

    expect(context).toBeUndefined();
    expect(agentDocumentService.listDocuments).not.toHaveBeenCalled();
  });

  it('merges initial contexts without losing nested runtime context', () => {
    const context = mergeAgentRuntimeInitialContexts(
      {
        initialContext: {
          activeTopicDocument: {
            agentDocumentId: 'agd_1',
            documentId: 'docs_1',
          },
        },
        phase: 'init',
      },
      {
        initialContext: {
          mentionedAgents: [{ id: 'agt_2', name: 'Agent 2' }],
        },
        phase: 'init',
      },
    );

    expect(context?.initialContext).toEqual({
      activeTopicDocument: {
        agentDocumentId: 'agd_1',
        documentId: 'docs_1',
      },
      mentionedAgents: [{ id: 'agt_2', name: 'Agent 2' }],
    });
  });
});
