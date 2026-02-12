 
import { App } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelSupportVision } from '@/hooks/useModelSupportVision';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const DRAGGING_ROOT_ID = 'dragging-root';
export const getContainer = () => document.querySelector(`#${DRAGGING_ROOT_ID}`);

const handleDragOver = (e: DragEvent) => {
  if (!e.dataTransfer?.items || e.dataTransfer.items.length === 0) return;

  const isFile = e.dataTransfer.types.includes('Files');
  if (isFile) {
    e.preventDefault();
  }
};

const processEntry = async (entry: FileSystemEntry): Promise<File[]> => {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        resolve([file]);
      });
    } else if (entry.isDirectory) {
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      dirReader.readEntries(async (entries) => {
        const filesPromises = entries.map((element) => processEntry(element));
        const fileArrays = await Promise.all(filesPromises);
        resolve(fileArrays.flat());
      });
    } else {
      resolve([]);
    }
  });
};

const getFileListFromDataTransferItems = async (items: DataTransferItem[]) => {
  // get filesList
  const filePromises: Promise<File[]>[] = [];
  for (const item of items) {
    if (item.kind === 'file') {
      // Safari browser may throw error when using FileSystemFileEntry.file()
      // So we prioritize using getAsFile() method first for better browser compatibility
      const file = item.getAsFile();

      if (file) {
        filePromises.push(
          new Promise((resolve) => {
            resolve([file]);
          }),
        );
      } else {
        const entry = item.webkitGetAsEntry();

        if (entry) {
          filePromises.push(processEntry(entry));
        }
      }
    }
  }

  const fileArrays = await Promise.all(filePromises);
  return fileArrays.flat();
};

export const useDragUpload = (onUploadFiles: (files: File[]) => Promise<void>) => {
  const { t } = useTranslation('chat');
  const { message } = App.useApp();
  const [isDragging, setIsDragging] = useState(false);
  // When a file is dragged to a different area, the 'dragleave' event may be triggered,
  // causing isDragging to be mistakenly set to false.
  // to fix this issue, use a counter to ensure the status change only when drag event left the browser window .
  const dragCounter = useRef(0);

  const model = useAgentStore(agentSelectors.currentAgentModel);
  const provider = useAgentStore(agentSelectors.currentAgentModelProvider);
  const supportVision = useModelSupportVision(model, provider);

  const handleDragEnter = (e: DragEvent) => {
    if (!e.dataTransfer?.items || e.dataTransfer.items.length === 0) return;

    const isFile = e.dataTransfer.types.includes('Files');
    if (isFile) {
      dragCounter.current += 1;
      e.preventDefault();
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    if (!e.dataTransfer?.items || e.dataTransfer.items.length === 0) return;

    const isFile = e.dataTransfer.types.includes('Files');
    if (isFile) {
      e.preventDefault();

      // reset counter
      dragCounter.current -= 1;

      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    }
  };

  const handleDrop = async (e: DragEvent) => {
    if (!e.dataTransfer?.items || e.dataTransfer.items.length === 0) return;

    const isFile = e.dataTransfer.types.includes('Files');
    if (!isFile) return;

    e.preventDefault();

    // reset counter
    dragCounter.current = 0;

    setIsDragging(false);
    const items = Array.from(e.dataTransfer?.items);

    const files = await getFileListFromDataTransferItems(items);

    if (files.length === 0) return;

    // Check if there are image files and the model does not support vision
    const hasImageFiles = files.some((file) => file.type.startsWith('image/'));
    if (hasImageFiles && !supportVision) {
      message.warning(t('upload.clientMode.visionNotSupported'));
      return;
    }

    // upload files
    onUploadFiles(files);
  };

  const handlePaste = async (event: ClipboardEvent) => {
    // get files from clipboard
    if (!event.clipboardData) return;
    const items = Array.from(event.clipboardData?.items);

    const files = await getFileListFromDataTransferItems(items);
    if (files.length === 0) return;

    // Check if there are image files and the model does not support vision
    const hasImageFiles = files.some((file) => file.type.startsWith('image/'));
    if (hasImageFiles && !supportVision) {
      message.warning(t('upload.clientMode.visionNotSupported'));
      return;
    }

    onUploadFiles(files);
  };

  useEffect(() => {
    if (getContainer()) return;
    const root = document.createElement('div');
    root.id = DRAGGING_ROOT_ID;
    document.body.append(root);

    return () => {
      root.remove();
    };
  }, []);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('paste', handlePaste);
    };
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop, handlePaste]);

  return isDragging;
};
