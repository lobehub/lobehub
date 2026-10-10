import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolvePortalDocumentPath,
  usePortalDocumentHeaderActions,
  usePortalDocumentTitle,
} from './usePortalDocumentHeader';

const mockDocumentMeta = vi.hoisted(() => ({
  current: {
    filename: '开营筹备清单.md',
    title: '开营筹备清单',
  } as {
    content?: string;
    fileType?: string | null;
    filename?: string | null;
    title?: string | null;
  },
}));

const mockMutate = vi.hoisted(() => vi.fn());

vi.mock('@/libs/swr', () => ({
  useClientDataSWR: () => ({
    data: mockDocumentMeta.current,
    isLoading: false,
    mutate: mockMutate,
  }),
}));

const mockUpdateDocument = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/document', () => ({
  documentService: {
    getDocumentById: vi.fn(),
    updateDocument: mockUpdateDocument,
  },
}));

const mockInvalidate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@/services/document/invalidation', () => ({
  invalidateDocumentMutation: mockInvalidate,
}));

const mockAgentState = vi.hoisted(() => ({
  current: {
    activeAgentId: 'agent-1' as string | undefined,
  },
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: any) => selector(mockAgentState.current),
}));

const mockChatState = vi.hoisted(() => ({
  current: {
    portalStack: [
      {
        agentDocumentId: 'agent-document-1' as string | undefined,
        documentId: 'document-1',
        type: 'document',
      },
    ],
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: any) => selector(mockChatState.current),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  return {
    ...actual,
    toast: { error: toastError, success: toastSuccess },
  };
});

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://app.lobehub.com',
}));

/** Title the SWR cache holds after the most recent optimistic write/rollback. */
const lastCachedTitle = () => mockMutate.mock.lastCall?.[0]({ title: '' }).title;

describe('usePortalDocumentTitle', () => {
  beforeEach(() => {
    mockDocumentMeta.current = { filename: '开营筹备清单.md', title: '开营筹备清单' };
    mockChatState.current.portalStack[0].agentDocumentId = 'agent-document-1';
    mockUpdateDocument.mockClear();
    mockMutate.mockClear();
    mockInvalidate.mockClear();
    toastError.mockClear();
  });

  it('exposes the saved title (title before filename) and unlocks renaming', () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.savedTitle).toBe('开营筹备清单');
    expect(result.current.metaLocked).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('saves a trimmed title through the document service', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    await act(async () => {
      await result.current.saveTitle('  开营筹备清单 V2  ');
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      id: 'document-1',
      title: '开营筹备清单 V2',
    });
    expect(lastCachedTitle()).toBe('开营筹备清单 V2');
  });

  it('skips the write for an empty or unchanged title', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    await act(async () => {
      await result.current.saveTitle('   ');
      await result.current.saveTitle('开营筹备清单');
    });

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('rolls the optimistic title back when the write fails', async () => {
    mockUpdateDocument.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => usePortalDocumentTitle());

    // Rejects after rolling back, so the rename dialog stays open for a retry.
    await act(async () => {
      await expect(result.current.saveTitle('开营筹备清单 V2')).rejects.toThrow('network');
    });

    expect(toastError).toHaveBeenCalled();
    expect(lastCachedTitle()).toBe('开营筹备清单');
  });

  it('serializes overlapping saves: a stale rejected rename cannot roll back a newer one', async () => {
    let rejectFirst!: (e: Error) => void;
    mockUpdateDocument
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePortalDocumentTitle());

    // First (slow) rename — fire it without awaiting.
    void result.current.saveTitle('重命名一');
    // A newer rename is submitted while the first is in flight.
    const secondSave = result.current.saveTitle('重命名二');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The server calls are queued, not concurrent: while the first rename is
    // in flight only its write has reached the service.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).toHaveBeenCalledWith({ id: 'document-1', title: '重命名一' });

    // The older request now REJECTS — it must not touch the cache, because a
    // newer save already claimed the latest ticket.
    await act(async () => {
      rejectFirst(new Error('late failure'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await secondSave;
    });

    expect(mockUpdateDocument).toHaveBeenLastCalledWith({ id: 'document-1', title: '重命名二' });
    expect(lastCachedTitle()).toBe('重命名二');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('queues the second rename behind the in-flight one (server write order)', async () => {
    let releaseFirst!: (v: unknown) => void;
    mockUpdateDocument
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePortalDocumentTitle());

    void result.current.saveTitle('重命名一');
    const secondSave = result.current.saveTitle('重命名二');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still queued — only the first write has reached the service.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst(undefined);
      await secondSave;
    });

    // The second write fires only after the first settles, in submit order.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(2);
    expect(mockUpdateDocument).toHaveBeenLastCalledWith({ id: 'document-1', title: '重命名二' });
  });

  it('revalidates the agent-document list after a successful rename', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    await act(async () => {
      await result.current.saveTitle('开营筹备清单 V2');
    });

    expect(mockInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', documentId: 'document-1' }),
    );
  });

  it('locks meta for a managed skill index (rename must not rewrite SKILL.md)', async () => {
    mockDocumentMeta.current = {
      content: '---\nname: my-skill\n---\nbody',
      fileType: 'skills/index',
      filename: 'SKILL.md',
      title: 'SKILL.md',
    };

    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.metaLocked).toBe(true);
    await act(async () => {
      await result.current.saveTitle('renamed');
    });
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('is not loading for a loaded empty-title document', () => {
    mockDocumentMeta.current = { filename: '', title: '' };

    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.savedTitle).toBe('');
  });
});

describe('usePortalDocumentHeaderActions', () => {
  beforeEach(() => {
    mockChatState.current.portalStack[0].agentDocumentId = 'agent-document-1';
    mockAgentState.current.activeAgentId = 'agent-1';
  });

  it('links the agent-document route when the binding proves ownership', () => {
    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    expect(result.current.url).toBe('https://app.lobehub.com/agent/agent-1/docs/document-1');
  });

  it('links an unbound document (e.g. a goal deliverable) to the page editor', () => {
    mockChatState.current.portalStack[0].agentDocumentId = undefined;

    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    // The agent docs route redirects unowned ids to its index, so the link
    // must not point there.
    expect(result.current.path).toBe('/page/document-1');
    expect(result.current.url).toBe('https://app.lobehub.com/page/document-1');
  });

  it('refresh revalidates the document caches', async () => {
    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockInvalidate).toHaveBeenCalledWith({
      agentDocumentId: 'agent-document-1',
      agentId: 'agent-1',
      documentId: 'document-1',
    });
  });

  it('surfaces the resolved binding for menu gating', () => {
    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    expect(result.current.agentDocumentId).toBe('agent-document-1');
    expect(result.current.agentId).toBe('agent-1');
  });
});

describe('resolvePortalDocumentPath', () => {
  it('uses the agent docs route only for a bound document', () => {
    expect(resolvePortalDocumentPath('docs_abc', 'agt_1', 'ad_1')).toBe('/agent/agt_1/docs/abc');
    expect(resolvePortalDocumentPath('docs_abc', 'agt_1', undefined)).toBe('/page/abc');
    expect(resolvePortalDocumentPath(undefined, 'agt_1', 'ad_1')).toBeUndefined();
  });
});
