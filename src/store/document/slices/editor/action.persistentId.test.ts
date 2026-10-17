import { CommonPlugin, type IEditor, Kernel } from '@lobehub/editor';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '../../store';

vi.mock('@/services/document', () => ({ documentService: {} }));
vi.mock('@/services/notebook', () => ({ notebookService: {} }));

const paragraph = (nodeId: string, textId: string, text: string) => ({
  $: { properties: { nodeId } },
  children: [
    {
      $: { properties: { nodeId: textId } },
      detail: 0,
      format: 0,
      id: textId,
      mode: 'normal',
      style: '',
      text,
      type: 'text',
      version: 1,
    },
  ],
  direction: null,
  format: '',
  id: nodeId,
  indent: 0,
  textFormat: 0,
  textStyle: '',
  type: 'paragraph',
  version: 1,
});

const persistedEditorData = {
  root: {
    children: [
      paragraph('6w5t9drdmo', 'hot6lgl8jp', 'Alpha paragraph'),
      paragraph('7oxxhtqflo', 'n238mjg8x9', 'Beta paragraph'),
    ],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1,
  },
};

const createEditor = () => {
  const editor = new Kernel() as unknown as IEditor;
  editor.registerPlugins([CommonPlugin]);
  editor.initNodeEditor();
  return editor;
};

const topLevelIds = (editor: IEditor) =>
  (editor.getDocument('json') as unknown as typeof persistedEditorData).root.children.map(
    (node) => node.id,
  );

describe('DocumentStore - persisted node ids', () => {
  it.each([
    ['page', undefined],
    ['notebook', 'skillMarkdown'],
  ] as const)(
    'keeps stored node ids when hydrating a %s document',
    async (sourceType, contentFormat) => {
      const { result } = renderHook(() => useDocumentStore());
      const editor = createEditor();

      act(() => {
        result.current.initDocumentWithEditor({
          content: 'Alpha paragraph\n\nBeta paragraph',
          contentFormat,
          documentId: 'doc-persisted-ids',
          editor,
          editorData: structuredClone(persistedEditorData),
          sourceType,
        });
      });

      await act(() => result.current.onEditorInit(editor));

      expect(topLevelIds(editor)).toEqual(['6w5t9drdmo', '7oxxhtqflo']);
    },
  );
});
