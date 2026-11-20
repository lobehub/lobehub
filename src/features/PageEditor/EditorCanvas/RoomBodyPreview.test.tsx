/**
 * @vitest-environment happy-dom
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EditorCanvas } from '@/features/EditorCanvas';

import RoomBodyPreview from './RoomBodyPreview';

const previewEditor = { id: 'preview-editor' };
const storedEditorData = { root: { children: [{ type: 'paragraph' }] } };

vi.mock('@lobehub/editor/react', () => ({ useEditor: () => previewEditor }));

vi.mock('@/features/EditorCanvas', () => ({
  EditorCanvas: vi.fn(() => null),
}));

vi.mock('@/store/document', () => ({
  useDocumentStore: (selector: (state: unknown) => unknown) =>
    selector({
      documents: { 'doc-1': { content: 'stored body', editorData: storedEditorData } },
    }),
}));

describe('RoomBodyPreview', () => {
  it('renders the stored body read-only on its own editor', () => {
    render(<RoomBodyPreview documentId="doc-1" placeholder="Type" />);

    expect(vi.mocked(EditorCanvas).mock.lastCall?.[0]).toMatchObject({
      editable: false,
      editor: previewEditor,
      editorData: { content: 'stored body', editorData: storedEditorData },
      entityId: 'doc-1',
      placeholder: 'Type',
    });
  });
});
