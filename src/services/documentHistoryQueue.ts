import debug from 'debug';

import { normalizeEditorDataDiffNodes } from '@/libs/editor/normalizeDiffNodes';
import { documentService } from '@/services/document';

const log = debug('page:editor:history-queue');

interface QueueItem {
  documentId: string;
  editorData: string;
  saveSource: 'llm_call';
}

interface EditorSnapshotSource {
  getDocument: (type: 'json') => unknown;
}

interface EnqueueEditorSnapshotParams {
  documentId?: string;
  editor?: EditorSnapshotSource;
  saveSource?: 'llm_call';
}

class DocumentHistoryQueueService {
  private queue: QueueItem[] = [];
  private isProcessing = false;

  enqueue = (item: QueueItem) => {
    this.queue.push(item);
    void this.drain();
  };

  enqueueEditorSnapshot = ({
    documentId,
    editor,
    saveSource = 'llm_call',
  }: EnqueueEditorSnapshotParams) => {
    if (!documentId || !editor) return false;

    try {
      const editorData = normalizeEditorDataDiffNodes(
        editor.getDocument('json') as Record<string, unknown>,
      );
      this.enqueue({
        documentId,
        editorData: JSON.stringify(editorData),
        saveSource,
      });

      return true;
    } catch (error) {
      console.error(
        '[DocumentHistoryQueueService] Failed to capture editor history snapshot:',
        error,
      );
      return false;
    }
  };

  drain = async () => {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;
      try {
        await documentService.saveDocumentHistory({
          documentId: item.documentId,
          editorData: item.editorData,
          saveSource: item.saveSource,
        });
      } catch (error) {
        log('Failed to save history: %o', error);
      }
    }

    this.isProcessing = false;
  };

  flush = async () => {
    await this.drain();
  };
}

export const documentHistoryQueueService = new DocumentHistoryQueueService();
