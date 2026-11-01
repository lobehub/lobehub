import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocumentStore } from '../../store';
import { editorSelectors } from './selectors';

vi.mock('@/services/document', () => ({
  documentService: {
    updateDocument: vi.fn().mockResolvedValue({
      historyAppended: false,
      id: 'doc-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  },
}));

const seed = (overrides: Record<string, unknown> = {}) => {
  act(() => {
    useDocumentStore.getState().initDocumentWithEditor({
      content: '# Page',
      documentId: 'doc-1',
      editor: undefined as any,
      sourceType: 'page',
    });
    useDocumentStore.getState().internal_dispatchDocument({
      id: 'doc-1',
      type: 'updateDocument',
      value: overrides,
    });
  });
};

describe('DocumentStore agent edits', () => {
  beforeEach(() => {
    act(() => {
      Object.keys(useDocumentStore.getState().documents).forEach((id) =>
        useDocumentStore.getState().closeDocument(id),
      );
    });
  });

  it('holds the page while agent commands edit it', () => {
    seed();
    const isAgentEditing = () =>
      editorSelectors.isAgentEditing('doc-1')(useDocumentStore.getState());

    act(() => {
      useDocumentStore.getState().beginAgentEdit('doc-1');
      useDocumentStore.getState().beginAgentEdit('doc-1');
    });
    expect(isAgentEditing()).toBe(true);

    act(() => useDocumentStore.getState().endAgentEdit('doc-1'));
    expect(isAgentEditing()).toBe(true);

    act(() => useDocumentStore.getState().endAgentEdit('doc-1'));
    expect(isAgentEditing()).toBe(false);
  });

  it('releases every hold when the run is over', () => {
    seed({ agentEditing: 3 });

    act(() => useDocumentStore.getState().endAgentEdit('doc-1', { all: true }));

    expect(useDocumentStore.getState().documents['doc-1'].agentEditing).toBe(0);
  });

  it('saves unsaved typing before the agent reads the page', () => {
    seed({ isDirty: true });
    const performSave = vi.spyOn(useDocumentStore.getState(), 'performSave');

    act(() => useDocumentStore.getState().beginAgentEdit('doc-1'));

    expect(performSave).toHaveBeenCalledWith('doc-1');
  });

  it('does not save a clean page', () => {
    seed();
    const performSave = vi.spyOn(useDocumentStore.getState(), 'performSave');

    act(() => useDocumentStore.getState().beginAgentEdit('doc-1'));

    expect(performSave).not.toHaveBeenCalled();
  });
});
