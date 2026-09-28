'use client';

import { createContext, type PropsWithChildren, use } from 'react';

import { usePortalDocumentTitle } from './usePortalDocumentHeader';

type PortalDocumentTitleState = ReturnType<typeof usePortalDocumentTitle>;

const PortalDocumentTitleContext = createContext<PortalDocumentTitleState | null>(null);

/**
 * One title edit session per portal document, shared by the inline title and
 * the header's `…` menu — "Rename" in the menu opens the same inline editor.
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
