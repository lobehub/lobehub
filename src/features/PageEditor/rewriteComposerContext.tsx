'use client';

import type { CapturedCollaborativeRewriteSelection } from '@lobehub/editor';
import { createContext, type ReactNode, use } from 'react';

export interface PageRewriteContinuationTarget {
  outputText?: string | null;
  requestId: string;
  selection?: CapturedCollaborativeRewriteSelection | Record<string, unknown>;
  sessionId?: string | null;
}

export interface PageRewriteComposerValue {
  close: () => void;
  continuationTarget: PageRewriteContinuationTarget | null;
  /** Presentation only: submitted work uses a text cursor or atomic-card lease overlay. */
  draftHighlightVisible: boolean;
  selection: CapturedCollaborativeRewriteSelection | null;
  /** Increments whenever a fresh editor selection supersedes a continuation. */
  selectionVersion: number;
  setContinuationTarget: (target: PageRewriteContinuationTarget | null) => void;
  setDraftHighlightVisible: (visible: boolean) => void;
}

const PageRewriteComposerContext = createContext<PageRewriteComposerValue>({
  close: () => undefined,
  draftHighlightVisible: false,
  setDraftHighlightVisible: () => undefined,
  continuationTarget: null,
  selectionVersion: 0,
  setContinuationTarget: () => undefined,
  selection: null,
});

export const PageRewriteComposerProvider = ({
  children,
  value,
}: {
  children: ReactNode;
  value: PageRewriteComposerValue;
}) => <PageRewriteComposerContext value={value}>{children}</PageRewriteComposerContext>;

export const usePageRewriteComposer = (): PageRewriteComposerValue =>
  use(PageRewriteComposerContext);
