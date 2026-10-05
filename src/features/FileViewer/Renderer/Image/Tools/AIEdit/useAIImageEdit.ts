import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { fileManagerSelectors, useFileStore } from '@/store/file';
import { useGlobalStore } from '@/store/global';

import { useImageStage } from '../../context';
import { ImagePixelsUnavailableError } from '../exportImage';
import { aiEditDeps } from './deps';
import { type AIEditOperation, resolveAIEditModel } from './request';
import {
  type AIEditDeps,
  type AIEditErrorKind,
  type AIEditPhase,
  type AIEditResult,
  AIImageEditError,
  runAIImageEdit,
} from './runAIImageEdit';

export type AIEditState =
  | { status: 'idle' }
  | { phase: AIEditPhase; startedAt: number; status: 'running' }
  | {
      kind: Exclude<AIEditErrorKind, 'cancelled'>;
      message?: string;
      status: 'error';
      /** The server task keeps running; its result shows up in image generation. */
      taskRunning?: boolean;
    };

/**
 * Run one AI edit of the image on stage and track its progress. The result is
 * saved as a new file next to the original; the original is never written.
 */
export const useAIImageEdit = (operation: AIEditOperation, deps: AIEditDeps = aiEditDeps) => {
  const { t } = useTranslation('file');
  const { addVersion, fileId, name, url } = useImageStage();
  const [state, setState] = useState<AIEditState>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);

  // Leaving the tool abandons the edit, same as pressing cancel.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const run = useCallback(
    async (prepareGuide?: () => Promise<Blob>): Promise<AIEditResult | undefined> => {
      const { lastSelectedImageModel, lastSelectedImageProvider } =
        useGlobalStore.getState().status;
      const model = resolveAIEditModel(
        aiProviderSelectors.enabledImageModelList(getAiInfraStoreState()),
        { model: lastSelectedImageModel, provider: lastSelectedImageProvider },
      );
      if (!model) {
        setState({ kind: 'noModel', status: 'error' });
        return;
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      const startedAt = Date.now();
      setState({
        phase: operation === 'erase' ? 'uploading' : 'generating',
        startedAt,
        status: 'running',
      });

      const source = fileManagerSelectors.getFileByChunkTargetId(fileId)(useFileStore.getState());

      let guide: Blob | undefined;
      if (prepareGuide) {
        try {
          guide = await prepareGuide();
        } catch (error) {
          console.error('[ImageViewer] erase guide render failed', error);
          if (controllerRef.current === controller) controllerRef.current = null;
          setState({ status: 'idle' });
          toast.error(
            error instanceof ImagePixelsUnavailableError
              ? t('imageViewer.pixelsUnavailable')
              : t('imageViewer.saveFailed'),
          );
          return;
        }
      }

      try {
        const result = await runAIImageEdit({
          deps,
          guide,
          model,
          onPhase: (phase) => {
            if (!controller.signal.aborted) setState({ phase, startedAt, status: 'running' });
          },
          operation,
          signal: controller.signal,
          source: { fileId, name, parentId: source?.parentId, url },
          topicTitle: t('imageViewer.ai.topicTitle', {
            name: name || 'image',
            operation: t(`imageViewer.tool.${operation}`),
          }),
        });

        setState({ status: 'idle' });
        void useFileStore.getState().refreshFileList({ revalidateResources: true });
        toast.success(t('imageViewer.saved', { name: result.name }));
        addVersion({ fileId: result.fileId, name: result.name, operation, url: result.url });
        return result;
      } catch (error) {
        const edit =
          error instanceof AIImageEditError ? error : new AIImageEditError('failed', String(error));
        if (edit.kind === 'cancelled') {
          setState({ status: 'idle' });
          toast.info(
            t(edit.taskRunning ? 'imageViewer.ai.stoppedWaiting' : 'imageViewer.ai.cancelled'),
          );
          return;
        }
        console.error('[ImageViewer] AI edit failed', error);
        setState({
          kind: edit.kind,
          message: edit.message,
          status: 'error',
          taskRunning: edit.taskRunning,
        });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    },
    [addVersion, deps, fileId, name, operation, t, url],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);
  const reset = useCallback(() => setState({ status: 'idle' }), []);

  return { cancel, reset, run, state };
};
