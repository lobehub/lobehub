import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePortalDocumentHeaderActions, usePortalDocumentTitle } from './usePortalDocumentHeader';

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
const clipboardWrite = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@lobehub/ui/base-ui', async (importOriginal) => {
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

describe('usePortalDocumentTitle', () => {
  beforeEach(() => {
    mockDocumentMeta.current = { filename: '开营筹备清单.md', title: '开营筹备清单' };
    mockChatState.current.portalStack[0].agentDocumentId = 'agent-document-1';
    mockUpdateDocument.mockClear();
    mockMutate.mockClear();
    mockInvalidate.mockClear();
    toastError.mockClear();
  });

  it('exposes the saved title (title before filename) and unlocks editing', () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.savedTitle).toBe('开营筹备清单');
    expect(result.current.metaLocked).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('commits a renamed title through the document service', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    act(() => result.current.startEdit());
    act(() => result.current.setDraft('开营筹备清单 V2'));
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      id: 'document-1',
      title: '开营筹备清单 V2',
    });
    expect(result.current.editing).toBe(false);
  });

  it('rolls the optimistic title back when the write fails', async () => {
    mockUpdateDocument.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => usePortalDocumentTitle());

    act(() => result.current.startEdit());
    act(() => result.current.setDraft('开营筹备清单 V2'));
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(toastError).toHaveBeenCalled();
    expect(result.current.draft).toBe('开营筹备清单');
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

    // First (slow) rename — its promise never resolves until the stale reject
    // below, so fire it without awaiting.
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('重命名一'));
    void result.current.commitEdit();

    // A newer rename lands first (fast server response).
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('重命名二'));
    const secondCommit = result.current.commitEdit();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The server calls are queued, not concurrent: while the first rename is
    // in flight only its write has reached the service.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);
    expect(mockUpdateDocument).toHaveBeenCalledWith({ id: 'document-1', title: '重命名一' });

    // The older request now REJECTS — it must not touch draft or cache,
    // because a newer save already claimed the latest ticket.
    await act(async () => {
      rejectFirst(new Error('late failure'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await act(async () => {
      await secondCommit;
    });

    expect(result.current.draft).toBe('重命名二');
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

    // First rename — held in flight by the server mock.
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('重命名一'));
    void result.current.commitEdit();

    // Second rename submitted while the first is pending.
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('重命名二'));
    const secondCommit = result.current.commitEdit();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Still queued — only the first write has reached the service.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst(undefined);
      await secondCommit;
    });

    // The second write fires only after the first settles, in submit order.
    expect(mockUpdateDocument).toHaveBeenCalledTimes(2);
    expect(mockUpdateDocument).toHaveBeenLastCalledWith({ id: 'document-1', title: '重命名二' });
    expect(result.current.draft).toBe('重命名二');
  });

  it('revalidates the agent-document list after a successful rename', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    act(() => result.current.startEdit());
    act(() => result.current.setDraft('开营筹备清单 V2'));
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(mockInvalidate).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', documentId: 'document-1' }),
    );
  });

  it('does not persist a cancelled title when Escape triggers the blur commit', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    act(() => result.current.startEdit());
    act(() => result.current.setDraft('被取消的名字'));

    // Escape path: cancelEdit runs first, then the input blur fires
    // `commitEdit` synchronously with the still-edited draft.
    act(() => result.current.cancelEdit());
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(result.current.draft).toBe('开营筹备清单');
    expect(result.current.editing).toBe(false);
  });

  it('re-arms the cancel flag so the next real commit still writes', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    // Cancel one edit...
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('被取消的名字'));
    act(() => result.current.cancelEdit());
    await act(async () => {
      await result.current.commitEdit();
    });
    expect(mockUpdateDocument).not.toHaveBeenCalled();

    // ...then commit a fresh rename normally.
    act(() => result.current.startEdit());
    act(() => result.current.setDraft('开营筹备清单 V2'));
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      id: 'document-1',
      title: '开营筹备清单 V2',
    });
  });

  it('clears a dangling cancel when a new edit session starts', async () => {
    const { result } = renderHook(() => usePortalDocumentTitle());

    // Cancel without the follow-up blur commit (e.g. input unmounted first).
    act(() => result.current.startEdit());
    act(() => result.current.cancelEdit());

    act(() => result.current.startEdit());
    act(() => result.current.setDraft('开营筹备清单 V2'));
    await act(async () => {
      await result.current.commitEdit();
    });

    expect(mockUpdateDocument).toHaveBeenCalledWith({
      id: 'document-1',
      title: '开营筹备清单 V2',
    });
  });

  it('locks meta for a managed skill index (rename must not rewrite SKILL.md)', () => {
    mockDocumentMeta.current = {
      content: '---\nname: my-skill\n---\nbody',
      fileType: 'skills/index',
      filename: 'SKILL.md',
      title: 'SKILL.md',
    };

    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.metaLocked).toBe(true);
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(false);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('exposes the editor (not loading) for a loaded empty-title document', () => {
    mockDocumentMeta.current = { filename: '', title: '' };

    const { result } = renderHook(() => usePortalDocumentTitle());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.savedTitle).toBe('');
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
  });
});

describe('usePortalDocumentHeaderActions', () => {
  beforeEach(() => {
    mockChatState.current.portalStack[0].agentDocumentId = 'agent-document-1';
    mockAgentState.current.activeAgentId = 'agent-1';
    clipboardWrite.mockClear();
    toastSuccess.mockClear();
    // jsdom exposes `navigator.clipboard` as getter-only; swap it per test.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
  });

  it('copies the agent-document URL when the binding proves ownership', async () => {
    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    await act(async () => {
      await result.current.copyLink();
    });

    expect(clipboardWrite).toHaveBeenCalledWith(
      'https://app.lobehub.com/agent/agent-1/docs/document-1',
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('refuses to copy a link for a plain document with no agent binding', async () => {
    mockChatState.current.portalStack[0].agentDocumentId = undefined;

    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    await act(async () => {
      await result.current.copyLink();
    });

    // No URL was composed (no-op), and no success toast fired.
    expect(clipboardWrite).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('surfaces the resolved binding for menu gating', () => {
    const { result } = renderHook(() => usePortalDocumentHeaderActions());

    expect(result.current.agentDocumentId).toBe('agent-document-1');
    expect(result.current.agentId).toBe('agent-1');
  });
});
