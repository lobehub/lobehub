'use client';

import { EditorProvider } from '@lobehub/editor/react';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

import { useResolvedDocumentId } from './documentViewContext';

const Wrapper = memo<PropsWithChildren>(({ children }) => {
  const documentId = useResolvedDocumentId();

  if (!documentId) return null;

  return <EditorProvider>{children}</EditorProvider>;
});

export default Wrapper;
