import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentMoreMenu } from './useMoreMenu';

const mocks = vi.hoisted(() => ({
  agentDocumentId: 'adoc_1' as string | undefined,
  agentId: 'agt_1',
  clearPortalStack: vi.fn(),
  closeDocument: vi.fn(),
  confirmModal: vi.fn(),
  documentId: 'doc_1' as string | undefined,
  exportHtml: undefined as (() => Promise<void>) | undefined,
  exportMarkdown: vi.fn() as (() => Promise<void>) | undefined,
  isLoading: false,
  metaLocked: false,
  navigate: vi.fn(),
  openRenameModal: vi.fn(),
  path: '/agent/agt_1/docs/doc_1' as string | undefined,
  refresh: vi.fn(),
  removeDocument: vi.fn(),
  saveTitle: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  url: 'https://app.lobehub.com/agent/agt_1/docs/doc_1' as string | undefined,
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmModal: mocks.confirmModal,
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock('@/components/RenameModal', () => ({
  openRenameModal: mocks.openRenameModal,
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { removeDocument: mocks.removeDocument },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) =>
    selector({ clearPortalStack: mocks.clearPortalStack, closeDocument: mocks.closeDocument }),
}));

vi.mock('@/features/Workspace/useWorkspaceAwareNavigate', () => ({
  useWorkspaceAwareNavigate: () => mocks.navigate,
}));

vi.mock('./useHtmlExport', () => ({
  useHtmlExport: () => mocks.exportHtml,
}));

vi.mock('./titleContext', () => ({
  usePortalDocumentTitleState: () => ({
    isLoading: mocks.isLoading,
    metaLocked: mocks.metaLocked,
    savedTitle: 'Spring Trail Collection — Launch Brief',
    saveTitle: mocks.saveTitle,
  }),
}));

vi.mock('./useMarkdownExport', () => ({
  useMarkdownExport: () => mocks.exportMarkdown,
}));

vi.mock('./usePortalDocumentHeader', () => ({
  TITLE_MAX_LENGTH: 100,
  usePortalDocumentHeaderActions: () => ({
    agentDocumentId: mocks.agentDocumentId,
    agentId: mocks.agentId,
    documentId: mocks.documentId,
    path: mocks.path,
    refresh: mocks.refresh,
    url: mocks.url,
  }),
}));

describe('useDocumentMoreMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.agentDocumentId = 'adoc_1';
    mocks.documentId = 'doc_1';
    mocks.exportHtml = undefined;
    mocks.exportMarkdown = vi.fn();
    mocks.path = '/agent/agt_1/docs/doc_1';
    mocks.isLoading = false;
    mocks.metaLocked = false;
    mocks.url = 'https://app.lobehub.com/agent/agt_1/docs/doc_1';
  });

  it('declares every capability an agent-bound document offers', () => {
    const { result } = renderHook(() => useDocumentMoreMenu());

    expect(result.current).toMatchObject({
      copyId: 'doc_1',
      copyLink: 'https://app.lobehub.com/agent/agt_1/docs/doc_1',
    });
    expect(result.current?.rename).toBeTypeOf('function');
    expect(result.current?.refresh).toBeTypeOf('function');
    expect(result.current?.delete).toBeTypeOf('function');
  });

  it('renames through a dialog seeded with the saved title', async () => {
    const { result } = renderHook(() => useDocumentMoreMenu());
    result.current!.rename!();

    expect(mocks.openRenameModal).toHaveBeenCalledOnce();
    const options = mocks.openRenameModal.mock.calls[0][0];
    expect(options).toMatchObject({
      defaultValue: 'Spring Trail Collection — Launch Brief',
      maxLength: 100,
    });

    // Saving goes through the shared serialized title write.
    await options.onSave('Spring Trail Brief');
    expect(mocks.saveTitle).toHaveBeenCalledWith('Spring Trail Brief');
  });

  it('opens a danger confirmation before removing the document', () => {
    const { result } = renderHook(() => useDocumentMoreMenu());
    result.current!.delete!();

    expect(mocks.confirmModal).toHaveBeenCalledOnce();
    expect(mocks.confirmModal.mock.calls[0][0].okButtonProps).toEqual({ danger: true });
    // Nothing is removed until the user confirms.
    expect(mocks.removeDocument).not.toHaveBeenCalled();
  });

  it('removes the document and closes the panel that showed it', async () => {
    mocks.removeDocument.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDocumentMoreMenu());
    result.current!.delete!();

    await mocks.confirmModal.mock.calls[0][0].onOk();

    expect(mocks.removeDocument).toHaveBeenCalledWith({
      agentId: 'agt_1',
      documentId: 'doc_1',
      id: 'adoc_1',
      withChildren: true,
    });
    expect(mocks.closeDocument).toHaveBeenCalledOnce();
  });

  it('keeps the panel open and reports the error when removal fails', async () => {
    mocks.removeDocument.mockRejectedValueOnce(new Error('document is locked'));
    const { result } = renderHook(() => useDocumentMoreMenu());
    result.current!.delete!();

    await mocks.confirmModal.mock.calls[0][0].onOk();

    expect(mocks.closeDocument).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith('document is locked');
  });

  it('hides delete for a document with no agent-documents binding', () => {
    mocks.agentDocumentId = undefined;
    const { result } = renderHook(() => useDocumentMoreMenu());

    // The capability is absent, never rendered disabled.
    expect(result.current?.delete).toBeUndefined();
    expect(result.current?.copyId).toBe('doc_1');
  });

  it('hides rename but keeps delete when the document metadata is locked', () => {
    mocks.metaLocked = true;
    const { result } = renderHook(() => useDocumentMoreMenu());

    expect(result.current?.rename).toBeUndefined();
    expect(result.current?.delete).toBeTypeOf('function');
  });

  it('shows no menu without a document', () => {
    mocks.documentId = undefined;
    const { result } = renderHook(() => useDocumentMoreMenu());

    expect(result.current).toBeUndefined();
  });

  const extraItem = (menu: ReturnType<typeof useDocumentMoreMenu>, key: string) =>
    menu?.extraItems?.find((item) => item && 'key' in item && item.key === key) as
      { key: string; onClick: () => void } | undefined;

  it('offers the markdown export as a menu action', () => {
    const { result } = renderHook(() => useDocumentMoreMenu());
    extraItem(result.current, 'export')!.onClick();

    expect(mocks.exportMarkdown).toHaveBeenCalledOnce();
  });

  it('downloads an HTML page as HTML instead of Markdown', () => {
    mocks.exportHtml = vi.fn();
    const { result } = renderHook(() => useDocumentMoreMenu());
    extraItem(result.current, 'export')!.onClick();

    expect(mocks.exportHtml).toHaveBeenCalledOnce();
    expect(mocks.exportMarkdown).not.toHaveBeenCalled();
  });

  it('leaves the export out when the document cannot be exported', () => {
    mocks.exportMarkdown = undefined;
    const { result } = renderHook(() => useDocumentMoreMenu());

    expect(extraItem(result.current, 'export')).toBeUndefined();
  });

  it('opens the document as a full page and closes the panel', () => {
    const { result } = renderHook(() => useDocumentMoreMenu());
    extraItem(result.current, 'open-as-page')!.onClick();

    expect(mocks.navigate).toHaveBeenCalledWith('/agent/agt_1/docs/doc_1');
    expect(mocks.clearPortalStack).toHaveBeenCalledOnce();
  });
});
