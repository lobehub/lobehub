import { type TFunction } from 'i18next';
import { type ChangeEvent } from 'react';
import { useCallback } from 'react';

import { type FileManageAction } from '@/store/file/slices/fileManager/action';
import {
  filterFilesByBuiltInBlockList,
  filterFilesByGitignore,
  findGitignoreFile,
  readGitignoreContent,
} from '@/utils/gitignore';

interface UseUploadFolderOptions {
  currentFolderId?: string | null;
  libraryId?: string | null;
  t: TFunction<'file'>;
  uploadFolderWithStructure: FileManageAction['uploadFolderWithStructure'];
}

const useUploadFolder = ({
  currentFolderId,
  libraryId,
  t,
  uploadFolderWithStructure,
}: UseUploadFolderOptions) => {
  const handleFolderUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      let files = Array.from(event.target.files || []);
      if (files.length === 0) return;

      const targetFolderId = currentFolderId ?? undefined;
      const targetLibraryId = libraryId ?? undefined;
      const upload = async (fileList: File[]) =>
        uploadFolderWithStructure(fileList, targetLibraryId, targetFolderId);

      // Apply built-in block list first
      const originalCount = files.length;
      files = filterFilesByBuiltInBlockList(files);
      const builtInBlockedCount = originalCount - files.length;

      if (builtInBlockedCount > 0) {
        const { message } = await import('antd');
        message.info(
          t('header.actions.builtInBlockList.filtered', {
            ignored: builtInBlockedCount,
            total: originalCount,
          }),
        );
      }

      const gitignoreFile = findGitignoreFile(files);

      if (gitignoreFile) {
        try {
          const gitignoreContent = await readGitignoreContent(gitignoreFile);
          const gitignoreOriginalCount = files.length;

          const { Modal } = await import('antd');

          Modal.confirm({
            cancelText: t('header.actions.gitignore.cancel'),
            content: t('header.actions.gitignore.content', {
              count: gitignoreOriginalCount,
            }),
            okText: t('header.actions.gitignore.apply'),
            onCancel: () => {
              // Upload without awaiting - let it run in background
              upload(files);
            },
            onOk: async () => {
              const filteredFiles = filterFilesByGitignore(files, gitignoreContent);
              const ignoredCount = gitignoreOriginalCount - filteredFiles.length;

              if (ignoredCount > 0) {
                const { message } = await import('antd');
                message.info(
                  t('header.actions.gitignore.filtered', {
                    ignored: ignoredCount,
                    total: gitignoreOriginalCount,
                  }),
                );
              }

              // Upload without awaiting - let it run in background
              upload(filteredFiles);
            },
            title: t('header.actions.gitignore.title'),
          });
        } catch (error) {
          console.error('Failed to read .gitignore:', error);
          await upload(files);
        }
      } else {
        await upload(files);
      }

      event.target.value = '';
    },
    [currentFolderId, libraryId, t, uploadFolderWithStructure],
  );

  return { handleFolderUpload };
};

export default useUploadFolder;
