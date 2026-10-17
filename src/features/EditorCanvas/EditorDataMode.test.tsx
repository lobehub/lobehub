import type { IEditor } from '@lobehub/editor';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// InternalEditor is the mounting surface; stub it out so the component tree
// stays free of the real Lexical mount while loadEditorContent still runs for
// real through handleInit -> loadContentWithLock.
const internalEditorSpy = vi.hoisted(() => ({
  onInit: null as null | ((editor: IEditor) => void),
}));

vi.mock('./InternalEditor', () => ({
  default: (props: { onInit: (editor: IEditor) => void }) => {
    internalEditorSpy.onInit = props.onInit;
    return null;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('EditorDataMode.loadEditorContent empty-parse shell tolerance', () => {
  it('routes a childless-root Lexical shell to the fallback instead of json hydration', async () => {
    vi.resetModules();
    const { EMPTY_EDITOR_STATE } = await import('@/libs/editor/constants');
    const mod = await import('./EditorDataMode');
    const mockEditor = { setDocument: vi.fn() } as unknown as IEditor;
    const baseProps = {
      editor: mockEditor,
      editorData: { content: '', editorData: undefined },
      onContentChange: vi.fn(),
      onInit: vi.fn(),
    } as any;

    const setDocumentSpy = vi.mocked(mockEditor.setDocument);
    setDocumentSpy.mockClear();
    internalEditorSpy.onInit = null;
    const { default: Component } = mod;
    render(
      <Component
        {...baseProps}
        editorData={{ content: '', editorData: { root: { children: [], type: 'root' } } } as any}
      />,
    );

    expect(internalEditorSpy.onInit).toBeTypeOf('function');
    // The component only loads when InternalEditor reports init; our stub
    // captured handleInit — invoke it the way InternalEditor would.
    internalEditorSpy.onInit?.(mockEditor);

    expect(setDocumentSpy).not.toHaveBeenCalledWith(
      'json',
      JSON.stringify({ root: { children: [], type: 'root' } }),
    );
    expect(setDocumentSpy).toHaveBeenCalledWith('json', JSON.stringify(EMPTY_EDITOR_STATE));
  });

  it('still loads a legacy non-Lexical payload via setDocument json', async () => {
    vi.resetModules();
    const mod = await import('./EditorDataMode');
    const mockEditor = { setDocument: vi.fn() } as unknown as IEditor;
    const baseProps = {
      editor: mockEditor,
      editorData: { content: '', editorData: undefined },
      onContentChange: vi.fn(),
      onInit: vi.fn(),
    } as any;

    const setDocumentSpy = vi.mocked(mockEditor.setDocument);
    setDocumentSpy.mockClear();
    internalEditorSpy.onInit = null;
    const { default: Component } = mod;
    render(
      <Component
        {...baseProps}
        editorData={{ content: '', editorData: { type: 'doc', content: [] } } as any}
      />,
    );

    internalEditorSpy.onInit?.(mockEditor);

    expect(setDocumentSpy).toHaveBeenCalledWith(
      'json',
      JSON.stringify({ type: 'doc', content: [] }),
    );
  });
});
