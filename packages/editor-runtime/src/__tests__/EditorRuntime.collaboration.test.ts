import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorRuntime } from '../EditorRuntime';

vi.mock('@lobehub/editor', () => ({
  IYjsService: { __serviceId: 'YjsService' },
}));

vi.mock('@lobehub/editor/litexml-commands', () => ({
  LITEXML_APPLY_COMMAND: 'litexml-apply',
  LITEXML_MODIFY_COMMAND: 'litexml-modify',
}));

const editorData = { root: { children: [{ type: 'paragraph' }] } };

const createEditor = (service: unknown = null) => ({
  requireService: vi.fn(() => service),
  setDocument: vi.fn(),
});

describe('EditorRuntime collaborative snapshot boundary', () => {
  let runtime: EditorRuntime;

  beforeEach(() => {
    runtime = new EditorRuntime();
  });

  it('rejects JSON and Markdown echoes before invoking the Yjs service', () => {
    const applyExternalEditorData = vi.fn().mockReturnValue(true);
    const editor = createEditor({ applyExternalEditorData });
    runtime.setEditor(editor as never);
    runtime.setCollaborationRequired(true);

    expect(runtime.applyServerSnapshot({ content: '# echo', editorData })).toBe(false);
    expect(applyExternalEditorData).not.toHaveBeenCalled();
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['connecting', null],
    ['fatal', { provider: null }],
  ])('keeps a %s provider state fail-closed', (_label, state) => {
    const applyExternalEditorData = vi.fn().mockReturnValue(true);
    const editor = createEditor({ applyExternalEditorData, getState: () => state });
    runtime.setEditor(editor as never);
    runtime.setCollaborationRequired(true);

    runtime.applyServerSnapshot({ content: '# stale echo' });

    expect(applyExternalEditorData).not.toHaveBeenCalled();
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('does not downgrade a service lookup exception to legacy import', () => {
    const editor = createEditor();
    editor.requireService.mockImplementation(() => {
      throw new Error('provider lookup failed');
    });
    runtime.setEditor(editor as never);

    expect(runtime.applyServerSnapshot({ editorData })).toBe(false);
    expect(editor.setDocument).not.toHaveBeenCalled();
  });

  it('retains legacy JSON and Markdown imports when no service is registered', () => {
    const editor = createEditor(null);
    runtime.setEditor(editor as never);

    expect(runtime.applyServerSnapshot({ editorData })).toBe(true);
    expect(runtime.applyServerSnapshot({ content: '# legacy' })).toBe(true);
    expect(editor.setDocument).toHaveBeenNthCalledWith(1, 'json', JSON.stringify(editorData), {
      keepId: true,
    });
    expect(editor.setDocument).toHaveBeenNthCalledWith(2, 'markdown', '# legacy', {
      keepId: true,
    });
  });

  it('keeps metadata available while rejecting the body', () => {
    const editor = createEditor({ applyExternalEditorData: vi.fn() });
    const titleSetter = vi.fn();
    runtime.setEditor(editor as never);
    runtime.setTitleHandlers(titleSetter, vi.fn());
    runtime.setCollaborationRequired(true);

    expect(runtime.applyServerSnapshot({ editorData, title: 'Updated title' })).toBe(true);
    expect(titleSetter).toHaveBeenCalledWith('Updated title');
    expect(editor.setDocument).not.toHaveBeenCalled();
  });
});
