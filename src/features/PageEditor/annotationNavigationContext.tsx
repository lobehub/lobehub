'use client';

import { createContext, type ReactNode, use, useMemo } from 'react';

export interface PageAnnotationNavigationRequest {
  annotationId: string;
  /** Monotonically increasing token; equal ids must still produce new requests. */
  token: number;
}

export interface PageAnnotationNavigationValue {
  request: PageAnnotationNavigationRequest | null;
  requestAnnotation: (annotationId: string) => void;
  /** Replace the current selection; an empty array clears it. */
  selectAnnotationIds: (ids: readonly string[]) => void;
  /** Annotation ids selected across the editor body and annotation rail. */
  selectedAnnotationIds: readonly string[];
}

const PageAnnotationNavigationContext = createContext<PageAnnotationNavigationValue>({
  request: null,
  requestAnnotation: () => undefined,
  selectedAnnotationIds: [],
  selectAnnotationIds: () => undefined,
});

export const PageAnnotationNavigationProvider = ({
  children,
  request,
  requestAnnotation,
  selectedAnnotationIds,
  selectAnnotationIds,
}: PageAnnotationNavigationValue & { children: ReactNode }) => {
  const value = useMemo(
    () => ({ request, requestAnnotation, selectedAnnotationIds, selectAnnotationIds }),
    [request, requestAnnotation, selectedAnnotationIds, selectAnnotationIds],
  );

  return (
    <PageAnnotationNavigationContext value={value}>{children}</PageAnnotationNavigationContext>
  );
};

export const usePageAnnotationNavigation = (): PageAnnotationNavigationValue =>
  use(PageAnnotationNavigationContext);
