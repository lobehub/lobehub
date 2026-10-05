'use client';

import { createContext, type PropsWithChildren, use } from 'react';

import { usePortalDocumentTitle } from './usePortalDocumentHeader';

type PortalDocumentTitleState = ReturnType<typeof usePortalDocumentTitle>;

const PortalDocumentTitleContext = createContext<PortalDocumentTitleState | null>(null);

/**
 * One title state per portal document, shared by the header title and the
 * header's `…` menu — "Rename" in the menu opens a dialog that saves through
 * the serialized title write.
 */
export const PortalDocumentTitleProvider = ({ children }: PropsWithChildren) => {
  const value = usePortalDocumentTitle();

  return <PortalDocumentTitleContext value={value}>{children}</PortalDocumentTitleContext>;
};

export const usePortalDocumentTitleState = (): PortalDocumentTitleState => {
  const value = use(PortalDocumentTitleContext);
  if (!value) throw new Error('usePortalDocumentTitleState must be used in the Document Wrapper');

  return value;
};
