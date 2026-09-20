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
