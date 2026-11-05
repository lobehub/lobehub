import { toast } from '@lobehub/ui';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fileManagerSelectors, useFileStore } from '@/store/file';

import { useImageStage } from '../context';
import {
  buildDerivedFileMetadata,
  buildDerivedFileName,
  DERIVED_FILE_SUFFIX,
  type DerivedImageOperation,
} from '../geometry';
import { aiEditDeps, loadStageImage } from './AIEdit/deps';
import { ImagePixelsUnavailableError } from './exportImage';
import { saveDerivedFile } from './saveDerivedFile';

/**
 * Render an edit of the current image and upload it as a new file next to the
 * original (same folder and libraries), recording lineage in metadata. The
 * original is kept.
 */
export const useSaveDerivedImage = (operation: DerivedImageOperation) => {
  const { t } = useTranslation('file');
  const { addVersion, fileId, name, setBusy, url } = useImageStage();
  const [saving, setSaving] = useState(false);
  // One save at a time, even if a shortcut fires before the state re-renders.
  const savingRef = useRef(false);

  const save = useCallback(
    async (render: (img: HTMLImageElement) => Promise<Blob>) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setBusy(true);
      try {
        const img = await loadStageImage(url);
        const blob = await render(img);
        const fileName = buildDerivedFileName(name, DERIVED_FILE_SUFFIX[operation]);
        const { refreshFileList } = useFileStore.getState();
        const source = fileManagerSelectors.getFileByChunkTargetId(fileId)(useFileStore.getState());

        const result = await saveDerivedFile(aiEditDeps, {
          file: new File([blob], fileName, { type: blob.type || 'image/png' }),
          metadata: buildDerivedFileMetadata(fileId, operation),
          parentId: source?.parentId,
          sourceId: fileId,
        });
        if (!result) return;

        void refreshFileList({ revalidateResources: true });
        if (result.libraryFailed)
          toast.warning(t('imageViewer.savedNotInLibrary', { name: fileName }));
        else toast.success(t('imageViewer.saved', { name: fileName }));
        addVersion({ fileId: result.id, name: fileName, operation, url: result.url });
        return { ...result, name: fileName };
      } catch (error) {
        console.error('[ImageViewer] save derived image failed', error);
        toast.error(
          error instanceof ImagePixelsUnavailableError
            ? t('imageViewer.pixelsUnavailable')
            : t('imageViewer.saveFailed'),
        );
      } finally {
        savingRef.current = false;
        setSaving(false);
        setBusy(false);
      }
    },
    [addVersion, fileId, name, operation, setBusy, t, url],
  );

  return { save, saving };
};
