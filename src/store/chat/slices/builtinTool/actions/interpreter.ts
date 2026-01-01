import { CloudSandboxIdentifier } from '@lobechat/builtin-tool-cloud-sandbox';
import {
  type CodeInterpreterFileItem,
  type CodeInterpreterParams,
  type CodeInterpreterResponse,
} from '@lobechat/types';
import debug from 'debug';
import { produce } from 'immer';
import pMap from 'p-map';
import { type SWRResponse } from 'swr';
import { type StateCreator } from 'zustand/vanilla';

import { useClientDataSWR } from '@/libs/swr';
import { fileService } from '@/services/file';
import { pythonService } from '@/services/python';
import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { useFileStore } from '@/store/file';
import { setNamespace } from '@/utils/storeDebug';

const n = setNamespace('codeInterpreter');
const log = debug('lobe-store:builtin-tool');

const SWR_FETCH_INTERPRETER_FILE_KEY = 'FetchCodeInterpreterFileItem';

export interface ChatCodeInterpreterAction {
  python: (id: string, params: CodeInterpreterParams) => Promise<boolean | undefined>;
  updateInterpreterFileItem: (
    id: string,
    updater: (data: CodeInterpreterResponse) => void,
  ) => Promise<void>;
  uploadInterpreterFiles: (id: string, files: CodeInterpreterFileItem[]) => Promise<void>;
  useFetchInterpreterFileItem: (id?: string) => SWRResponse;
}

export const codeInterpreterSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatCodeInterpreterAction
> = (set, get) => ({
  python: async (id: string, params: CodeInterpreterParams) => {
    // Get parent operationId from messageOperationMap (should be executeToolCall)
    const parentOperationId = get().messageOperationMap[id];

    // Create child operation for interpreter execution
    // Auto-associates message with this operation via messageId in context
    const { operationId: interpreterOpId, abortController } = get().startOperation({
      context: {
        messageId: id,
      },
      metadata: {
        startTime: Date.now(),
      },
      parentOperationId,
      type: 'builtinToolInterpreter',
    });

    log(
      '[python] messageId=%s, parentOpId=%s, interpreterOpId=%s, aborted=%s',
      id,
      parentOperationId,
      interpreterOpId,
      abortController.signal.aborted,
    );

    const context = { operationId: interpreterOpId };

    try {
      // TODO: 应该只下载 AI 用到的文件
      const files: File[] = [];
      for (const message of dbMessageSelectors.dbUserMessages(get())) {
        for (const file of message.fileList ?? []) {
          const blob = await fetch(file.url).then((res) => res.blob());
          files.push(new File([blob], file.name));
        }
        for (const image of message.imageList ?? []) {
          const blob = await fetch(image.url).then((res) => res.blob());
          files.push(new File([blob], image.alt));
        }
        for (const tool of message.tools ?? []) {
          if (tool.identifier === CloudSandboxIdentifier) {
            const message = dbMessageSelectors.getDbMessageByToolCallId(tool.id)(get());
            if (message?.content) {
              const content = JSON.parse(message.content) as CodeInterpreterResponse;
              for (const file of content.files ?? []) {
                const item = await fileService.getFile(file.fileId!);
                const blob = await fetch(item.url).then((res) => res.blob());
                files.push(new File([blob], file.filename));
              }
            }
          }
        }
      }

      const result = await pythonService.runPython(params.code, params.packages, files);

      // Complete interpreter operation
      get().completeOperation(interpreterOpId);

      if (result?.files) {
        await get().optimisticUpdateMessageContent(id, JSON.stringify(result), undefined, context);
        await get().uploadInterpreterFiles(id, result.files);
      } else {
        await get().optimisticUpdateMessageContent(id, JSON.stringify(result), undefined, context);
      }

      return true;
    } catch (error) {
      const err = error as Error;

      log('[python] Error: messageId=%s, error=%s', id, err.message);

      // Check if it's an abort error
      if (err.message.includes('The user aborted a request.') || err.name === 'AbortError') {
        log('[python] Request aborted: messageId=%s', id);
        // Fail interpreter operation for abort
        get().failOperation(interpreterOpId, {
          message: 'User cancelled the request',
          type: 'UserAborted',
        });
        // Don't update error message for user aborts
        return;
      }

      // Fail interpreter operation for other errors
      get().failOperation(interpreterOpId, {
        message: err.message,
        type: 'PluginServerError',
      });

      // For other errors, update message
      await get().optimisticUpdatePluginState(id, { error }, context);
      // 如果调用过程中出现了错误，不要触发 AI 消息
      return;
    }
  },

  updateInterpreterFileItem: async (
    id: string,
    updater: (data: CodeInterpreterResponse) => void,
  ) => {
    const message = dbMessageSelectors.getDbMessageById(id)(get());
    if (!message) return;

    const result: CodeInterpreterResponse = JSON.parse(message.content);
    if (!result.files) return;

    const nextResult = produce(result, updater);

    await get().optimisticUpdateMessageContent(id, JSON.stringify(nextResult));
  },

  uploadInterpreterFiles: async (id: string, files: CodeInterpreterFileItem[]) => {
    const { updateInterpreterFileItem } = get();

    if (!files) return;

    await pMap(files, async (file, index) => {
      if (!file.data) return;

      try {
        const uploadResult = await useFileStore.getState().uploadWithProgress({
          file: file.data,
          skipCheckFileType: true,
        });

        if (uploadResult?.id) {
          await updateInterpreterFileItem(id, (draft) => {
            if (draft.files?.[index]) {
              draft.files[index].fileId = uploadResult.id;
              draft.files[index].previewUrl = undefined;
              draft.files[index].data = undefined;
            }
          });
        }
      } catch (error) {
        console.error('Failed to upload CodeInterpreter file:', error);
      }
    });
  },

  useFetchInterpreterFileItem: (id) =>
    useClientDataSWR(id ? [SWR_FETCH_INTERPRETER_FILE_KEY, id] : null, async () => {
      if (!id) return null;

      const item = await fileService.getFile(id);

      set(
        produce((draft) => {
          if (!draft.codeInterpreterFileMap) {
            draft.codeInterpreterFileMap = {};
          }
          if (draft.codeInterpreterFileMap[id]) return;

          draft.codeInterpreterFileMap[id] = item;
        }),
        false,
        n('useFetchInterpreterFileItem'),
      );

      return item;
    }),
});
