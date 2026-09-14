'use client';

import type { AnnotationComposerContext } from '@lobehub/editor';
import { createContext, type ReactNode, use } from 'react';

export interface PageAnnotationComposerValue {
  composer: AnnotationComposerContext | null;
}

const PageAnnotationComposerContext = createContext<PageAnnotationComposerValue>({
  composer: null,
});

export const PageAnnotationComposerProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: PageAnnotationComposerValue;
}) => <PageAnnotationComposerContext value={value}>{children}</PageAnnotationComposerContext>;

export const usePageAnnotationComposer = (): PageAnnotationComposerValue =>
  use(PageAnnotationComposerContext);
