import { AttachmentsExecutionRuntime } from '@lobechat/builtin-tool-attachments/executionRuntime';
import { AttachmentsExecutor } from '@lobechat/builtin-tool-attachments/executor';

import { ragService } from '@/services/rag';

export const attachmentsExecutor = new AttachmentsExecutor(
  new AttachmentsExecutionRuntime({
    getFileContents: (fileIds, signal) => ragService.getFileContents(fileIds, signal),
  }),
);
