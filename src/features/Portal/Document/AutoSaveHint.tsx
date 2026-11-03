'use client';

import { memo } from 'react';

import { AutoSaveHint as SharedAutoSaveHint } from '@/features/EditorCanvas';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const AutoSaveHint = memo(() => {
  const documentId = useChatStore(chatPortalSelectors.portalDocumentId);

  if (!documentId) return null;

  return <SharedAutoSaveHint documentId={documentId} />;
});

export default AutoSaveHint;
