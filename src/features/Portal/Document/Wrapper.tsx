'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useResolvedDocumentId } from './documentViewContext';
import { PortalDocumentTitleProvider } from './titleContext';

const Wrapper = memo<PropsWithChildren>(({ children }) => {
  const documentId = useResolvedDocumentId();

  if (!documentId) return null;

  return (
    <EditorProvider>
      <PortalDocumentTitleProvider>{children}</PortalDocumentTitleProvider>
    </EditorProvider>
  );
});

export default Wrapper;
