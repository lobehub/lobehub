import { afterEach, describe, expect, it, vi } from 'vitest';

import { documentService } from '@/services/document';

import { documentHistoryQueueService } from './documentHistoryQueue';

vi.mock('@/services/document', () => ({
  documentService: {
    saveDocumentHistory: vi.fn(),
  },
}));

describe('DocumentHistoryQueueService', () => {
  afterEach(async () => {
    await Promise.resolve();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('enqueueEditorSnapshot', () => {
    it('should capture editor JSON and enqueue an llm_call history save', async () => {
      vi.mocked(documentService.saveDocumentHistory).mockResolvedValue({
        savedAt: new Date().toISOString(),
      });
      const editor = {
        getDocument: vi.fn(() => ({ root: true })),
      };

      const result = documentHistoryQueueService.enqueueEditorSnapshot({
        documentId: 'doc-1',
        editor,
      });
      await Promise.resolve();

      expect(result).toBe(true);
      expect(editor.getDocument).toHaveBeenCalledWith('json');
      expect(documentService.saveDocumentHistory).toHaveBeenCalledWith({
        documentId: 'doc-1',
        editorData: JSON.stringify({ root: true }),
        saveSource: 'llm_call',
      });
    });

    it('should save the origin content when the editor snapshot contains diff nodes', async () => {
      vi.mocked(documentService.saveDocumentHistory).mockResolvedValue({
        savedAt: new Date().toISOString(),
      });
      const editor = {
        getDocument: vi.fn(() => ({
          root: {
            children: [
              {
                children: [
                  { children: [{ text: 'origin', type: 'text' }], type: 'paragraph' },
                  { children: [{ text: 'modified', type: 'text' }], type: 'paragraph' },
                ],
                diffType: 'modify',
                type: 'diff',
              },
              {
                children: [{ children: [{ text: 'added', type: 'text' }], type: 'paragraph' }],
                diffType: 'add',
                type: 'diff',
              },
              {
                children: [{ children: [{ text: 'removed', type: 'text' }], type: 'paragraph' }],
                diffType: 'remove',
                type: 'diff',
              },
            ],
          },
        })),
      };

      const result = documentHistoryQueueService.enqueueEditorSnapshot({
        documentId: 'doc-1',
        editor,
      });
      await Promise.resolve();

      expect(result).toBe(true);
      expect(documentService.saveDocumentHistory).toHaveBeenCalledWith({
        documentId: 'doc-1',
        editorData: JSON.stringify({
          root: {
            children: [
              { children: [{ text: 'origin', type: 'text' }], type: 'paragraph' },
              { children: [{ text: 'removed', type: 'text' }], type: 'paragraph' },
            ],
          },
        }),
        saveSource: 'llm_call',
      });
    });

    it('should skip capture when document id or editor is missing', () => {
      expect(documentHistoryQueueService.enqueueEditorSnapshot({ editor: undefined })).toBe(false);
      expect(
        documentHistoryQueueService.enqueueEditorSnapshot({
          documentId: 'doc-1',
          editor: undefined,
        }),
      ).toBe(false);
      expect(documentService.saveDocumentHistory).not.toHaveBeenCalled();
    });

    it('should not enqueue history when editor snapshot capture fails', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const error = new Error('snapshot failed');
      const editor = {
        getDocument: vi.fn(() => {
          throw error;
        }),
      };

      const result = documentHistoryQueueService.enqueueEditorSnapshot({
        documentId: 'doc-1',
        editor,
      });

      expect(result).toBe(false);
      expect(documentService.saveDocumentHistory).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        '[DocumentHistoryQueueService] Failed to capture editor history snapshot:',
        error,
      );
    });
  });
});
