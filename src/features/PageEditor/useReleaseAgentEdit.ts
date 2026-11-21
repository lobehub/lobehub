'use client';

import { useEffect } from 'react';

import { useChatStore } from '@/store/chat';
import { useDocumentStore } from '@/store/document';

import { usePageEditorStore } from './store';

/**
 * Releases the page once no agent run edits it anymore. A cancelled or failed
 * run may never report the end of its last page command, which would otherwise
 * leave the page read-only.
 */
export const useReleaseAgentEdit = () => {
  const documentId = usePageEditorStore((s) => s.documentId);
  const hasRunningPageRun = useChatStore((s) =>
    documentId
      ? Object.values(s.operations).some(
          (op) =>
            op.status === 'running' &&
            op.context.scope === 'page' &&
            op.context.documentId === documentId,
        )
      : false,
  );

  useEffect(() => {
    if (!documentId || hasRunningPageRun) return;
    useDocumentStore.getState().endAgentEdit(documentId, { all: true });
  }, [documentId, hasRunningPageRun]);
};
