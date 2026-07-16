'use client';

import { createContext, memo, type ReactNode, use } from 'react';

import { type DiscoverSkillDetail } from '@/types/discover';

export type DetailContextConfig = Partial<DiscoverSkillDetail>;

export const DetailContext = createContext<DetailContextConfig>({});

export const DetailProvider = memo<{ children: ReactNode; config?: DetailContextConfig }>(
  ({ children, config = {} }) => {
    return <DetailContext value={config}>{children}</DetailContext>;
  },
);

export const useDetailContext = () => {
  return use(DetailContext);
};

/**
 * How navigation behaves where the detail is rendered: the modal swaps its own
 * content in place (and closes itself before leaving for another route), the
 * standalone page just navigates.
 */
export interface DetailActionContextValue {
  /** Present only in the modal — call before navigating away from the detail */
  close?: () => void;
  selectSkill?: (identifier: string) => void;
}

export const DetailActionContext = createContext<DetailActionContextValue>({});

export const useDetailActionContext = () => {
  return use(DetailActionContext);
};
