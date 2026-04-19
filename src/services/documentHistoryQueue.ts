import debug from 'debug';

import { documentService } from '@/services/document';

const log = debug('page:editor:history-queue');

interface QueueItem {
  documentId: string;
  editorData: string;
  saveSource: 'llm_call';
}

class DocumentHistoryQueueService {
  private queue: QueueItem[] = [];
  private isProcessing = false;

  enqueue = (item: QueueItem) => {
    this.queue.push(item);
    void this.drain();
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
