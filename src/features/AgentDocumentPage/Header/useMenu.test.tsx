/**
 * @vitest-environment happy-dom
 */
import type { DropdownItem } from '@lobehub/ui';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMenu } from './useMenu';

const mocks = vi.hoisted(() => ({
  documentDetailMap: {} as Record<string, { document?: { content?: string | null } }>,
  documents: {} as Record<string, { content?: string }>,
  exportFile: vi.fn(),
  isDesktop: false,
  isHtmlPage: false,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('@lobechat/const', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get isDesktop() {
    return mocks.isDesktop;
  },
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Icon: () => null,
  confirmModal: vi.fn(),
  cssVar: { colorTextTertiary: '#999' },
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
  useResponsive: () => ({ lg: true }),
}));

vi.mock('@/business/client/hooks/useActiveWorkspaceSlug', () => ({
  useActiveWorkspaceSlug: () => undefined,
}));

vi.mock('@/features/PageEditor/HtmlPageBody', () => ({
  useIsHtmlPage: () => mocks.isHtmlPage,
}));

vi.mock('@/hooks/useAppOrigin', () => ({
  useAppOrigin: () => 'https://example.com',
}));

vi.mock('@/services/agentDocument', () => ({
  agentDocumentService: { removeDocument: vi.fn() },
}));

vi.mock('@/services/electron/desktopExportService', () => ({
  desktopExportService: { exportFile: mocks.exportFile, exportMarkdown: mocks.exportFile },
}));

vi.mock('@/store/document', () => {
  const getState = () => ({
    documentDetailMap: mocks.documentDetailMap,
    documents: mocks.documents,
  });
  const useDocumentStore = Object.assign(
    (selector: (state: ReturnType<typeof getState>) => unknown) => selector(getState()),
    { getState },
  );
  return { useDocumentStore };
});

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: { toggleWideScreen: () => void }) => unknown) =>
    selector({ toggleWideScreen: vi.fn() }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: { wideScreen: () => false },
}));

const findExportMarkdownAction = (menuItems: DropdownItem[]) => {
  const exportItem = menuItems.find(
    (item): item is Extract<DropdownItem, { key?: unknown; children?: DropdownItem[] }> =>
      !!item && 'key' in item && item.key === 'export',
  );
  const mdItem = exportItem?.children?.find(
    (item): item is Extract<DropdownItem, { key?: unknown; onClick?: () => unknown }> =>
      !!item && 'key' in item && item.key === 'export-markdown',
  );
  return mdItem?.onClick as (() => Promise<void>) | undefined;
};

describe('AgentDocumentPage/Header/useMenu', () => {
  beforeEach(() => {
    mocks.documentDetailMap = {
      doc_1: { document: { content: '# Persisted Spec' } },
    };
    mocks.documents = {
      doc_1: { content: '# Live Spec' },
    };
    mocks.exportFile.mockReset();
    mocks.isDesktop = false;
    mocks.isHtmlPage = false;
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('exports the live document markdown from the document store in the browser', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:doc');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'Launch Spec',
      }),
    );

    const exportMarkdown = findExportMarkdownAction(result.current.menuItems);
    expect(exportMarkdown).toBeDefined();

    await act(async () => {
      await exportMarkdown!();
    });

    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('Launch Spec.md');
    expect(await createObjectURL.mock.calls[0][0].text()).toBe('# Live Spec');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:doc');
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('falls back to persisted document detail content when no live editor buffer exists', async () => {
    mocks.documents = {};
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:doc');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'Persisted',
      }),
    );

    await act(async () => {
      await findExportMarkdownAction(result.current.menuItems)!();
    });

    expect(await createObjectURL.mock.calls[0][0].text()).toBe('# Persisted Spec');
  });

  it('preserves an intentionally emptied live buffer instead of falling back to persisted content', async () => {
    mocks.documents = { doc_1: { content: '' } };
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:doc');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'Cleared',
      }),
    );

    await act(async () => {
      await findExportMarkdownAction(result.current.menuItems)!();
    });

    expect(await createObjectURL.mock.calls[0][0].text()).toBe('');
  });

  it('does not duplicate the .md extension when the title already ends with .md', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:doc'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'SKILL.md',
      }),
    );

    await act(async () => {
      await findExportMarkdownAction(result.current.menuItems)!();
    });

    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('SKILL.md');
  });

  it('saves via desktop export service without showing a duplicate browser toast on desktop', async () => {
    mocks.isDesktop = true;
    mocks.exportFile.mockResolvedValue({ canceled: false, filePath: '/tmp/Launch Spec.md' });

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'Launch Spec',
      }),
    );

    await act(async () => {
      await findExportMarkdownAction(result.current.menuItems)!();
    });

    expect(mocks.exportFile).toHaveBeenCalledWith({
      content: '# Live Spec',
      fileName: 'Launch Spec.md',
      filter: { extensions: ['md'], name: 'Markdown' },
    });
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('shows an error toast when exporting fails', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        throw new Error('blob error');
      }),
      revokeObjectURL: vi.fn(),
    });

    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        onDeleted: vi.fn(),
        title: 'Broken',
      }),
    );

    await act(async () => {
      await findExportMarkdownAction(result.current.menuItems)!();
    });

    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('omits export and full-width actions for file-backed documents', () => {
    const { result } = renderHook(() =>
      useMenu({
        agentId: 'agent_1',
        documentId: 'doc_1',
        fileBacked: true,
        onDeleted: vi.fn(),
        title: 'attachment.pdf',
      }),
    );

    const keys = result.current.menuItems
      .map((item) => (item && 'key' in item ? item.key : undefined))
      .filter(Boolean);
    expect(keys).not.toContain('export');
    expect(keys).not.toContain('full-width');
  });
});
