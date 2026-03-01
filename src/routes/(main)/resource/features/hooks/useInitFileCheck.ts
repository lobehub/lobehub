'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { documentSelectors, useFileStore } from '@/store/file';

import { useResourceManagerStore } from '../store';

/**
 * Used for initial loading only, handle URL like:
 *
 * /resource?file=xxxxxx
 */
export const useInitFileCheck = () => {
  const [searchParams] = useSearchParams();
  const [setMode, setCurrentViewItemId] = useResourceManagerStore((s) => [
    s.setMode,
    s.setCurrentViewItemId,
  ]);

  const fileId = searchParams.get('file');

  const useFetchKnowledgeItem = useFileStore((s) => s.useFetchKnowledgeItem);
  const { data: fileData } = useFetchKnowledgeItem(fileId || undefined);
  const documentData = useFileStore(documentSelectors.getDocumentById(fileId || undefined));

  useEffect(() => {
    if (fileId) {
      setCurrentViewItemId(fileId);

      if (fileData || documentData) {
        const isPDF =
          fileData?.fileType?.toLowerCase() === 'pdf' ||
          fileData?.fileType?.toLowerCase() === 'application/pdf' ||
          fileData?.name?.toLowerCase().endsWith('.pdf') ||
          documentData?.fileType?.toLowerCase() === 'pdf' ||
          documentData?.fileType?.toLowerCase() === 'application/pdf' ||
          documentData?.filename?.toLowerCase().endsWith('.pdf') ||
          documentData?.source?.toLowerCase().endsWith('.pdf');

        const isPage =
          !isPDF &&
          (fileData?.sourceType === 'document' ||
            fileData?.fileType === 'custom/document' ||
            !!documentData);

        if (isPDF) {
          setMode('editor');
        } else if (isPage) {
          setMode('page');
        } else {
          setMode('editor');
        }
      }
    } else {
      setMode('explorer');
      setCurrentViewItemId(undefined);
    }
  }, [fileId, fileData, documentData]);
};
