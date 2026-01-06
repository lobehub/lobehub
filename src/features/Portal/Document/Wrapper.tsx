'use client';

import { type PropsWithChildren, memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { DocumentEditorProvider } from './DocumentEditorProvider';

const Wrapper = memo<PropsWithChildren>(({ children }) => {
  const [topicId, documentId] = useChatStore((s) => [
    s.activeTopicId,
    chatPortalSelectors.portalDocumentId(s),
  ]);

  if (!documentId) return null;

  return (
    <DocumentEditorProvider documentId={documentId} topicId={topicId}>
      {children}
    </DocumentEditorProvider>
  );
});

export default Wrapper;
