'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const Wrapper = memo<PropsWithChildren>(({ children }) => {
  const documentId = useChatStore(chatPortalSelectors.portalDocumentId);

  if (!documentId) return null;

  return <EditorProvider>{children}</EditorProvider>;
});

export default Wrapper;
