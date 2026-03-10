'use client';

import { type ReactNode } from 'react';
import { createContext, memo, use } from 'react';

import { type DiscoverModelDetail } from '@/types/discover';

export type DetailContextConfig = Partial<DiscoverModelDetail>;

export const DetailContext = createContext<DetailContextConfig>({});

export const DetailProvider = memo<{ children: ReactNode; config?: DetailContextConfig }>(
  ({ children, config = {} }) => {
    return <DetailContext value={config}>{children}</DetailContext>;
  },
);

export const useDetailContext = () => {
  return use(DetailContext);
};
