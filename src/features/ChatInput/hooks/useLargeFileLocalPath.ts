'use client';

import type { IEditor } from '@lobehub/editor';
import { toast } from '@lobehub/ui/base-ui';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { DroppedLocalPath } from '@/components/DragUploadZone';
import { insertLocalPathTags } from '@/features/ChatInput/InputEditor/insertLocalFileTags';
import { useLocalPathReference } from '@/features/Conversation/useLocalPathReference';
import { getElectronLocalFilePath } from '@/utils/electron/localFilePath';

import { useTopicId } from './useTopicId';

/**
 * Non-media files above this size are referenced by local path instead of uploaded when the run
 * can read this machine's filesystem.
 *
 * Uploading parses the whole file into text that is inlined into the prompt; large spreadsheets,
 * CSV exports, and logs overflow the context window that way. Local tools can page, grep, or
 * script over the original file instead.
 */
export const LOCAL_PATH_REFERENCE_MIN_FILE_SIZE = 1024 * 1024;

/** Folder picks call the router once per file; show the notice at most once per burst. */
const NOTICE_THROTTLE_MS = 3000;

const isMediaFile = (file: File) =>
  file.type.startsWith('image') || file.type.startsWith('video') || file.type.startsWith('audio');

export interface PartitionedLargeLocalFiles {
  files: File[];
  localPaths: DroppedLocalPath[];
}

/**
 * Split picked or pasted files into large non-media files that resolve to a local path and files
 * that should still be uploaded. Media keeps uploading so vision/audio models receive it directly.
 */
export const partitionLargeFilesAsLocalPaths = (
  files: File[],
  resolvePath: (file: File) => string | null = getElectronLocalFilePath,
): PartitionedLargeLocalFiles => {
  const result: PartitionedLargeLocalFiles = { files: [], localPaths: [] };

  for (const file of files) {
    const path =
      !isMediaFile(file) && file.size > LOCAL_PATH_REFERENCE_MIN_FILE_SIZE
        ? resolvePath(file)
        : null;
    if (path) {
      result.localPaths.push({ isDirectory: false, name: file.name, path });
    } else {
      result.files.push(file);
    }
  }

  return result;
};

/**
 * Routes large picked/pasted files (including files inside a picked folder) to `<localFile>` references in the given editor on desktop and
 * returns the files that still need uploading. Outside desktop local execution it returns the
 * input unchanged, matching the drag-and-drop routing in `useLocalPathReference`.
 */
export const useLargeFileLocalPath = (agentId: string, editor: IEditor | undefined) => {
  const { t } = useTranslation('chat');
  const topicId = useTopicId();
  const { enableLocalPathReference } = useLocalPathReference(agentId, topicId);
  const lastNoticeAt = useRef(0);

  return useCallback(
    (files: File[]): File[] => {
      if (!enableLocalPathReference || !editor) return files;

      const partitioned = partitionLargeFilesAsLocalPaths(files);
      if (partitioned.localPaths.length > 0) {
        insertLocalPathTags(editor, partitioned.localPaths);
        // Tell the user why the file shows up as a path chip instead of an upload card.
        if (Date.now() - lastNoticeAt.current > NOTICE_THROTTLE_MS) {
          lastNoticeAt.current = Date.now();
          toast.info(t('upload.localPathReference'));
        }
      }
      return partitioned.files;
    },
    [editor, enableLocalPathReference, t],
  );
};
