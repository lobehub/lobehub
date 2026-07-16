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
 * How "open another skill" behaves where the detail is rendered: the modal
 * swaps its own content in place, the standalone page navigates.
 */
export interface DetailActionContextValue {
  selectSkill?: (identifier: string) => void;
}

export const DetailActionContext = createContext<DetailActionContextValue>({});

export const useDetailActionContext = () => {
  return use(DetailActionContext);
};
