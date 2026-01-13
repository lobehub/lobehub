'use client';

import { type ReactNode, createContext, memo, use } from 'react';

import { type DiscoverPluginDetail } from '@/types/discover';

export type DetailContextConfig = Partial<DiscoverPluginDetail>;

export const DetailContext = createContext<DetailContextConfig>({});

export const DetailProvider = memo<{ children: ReactNode; config?: DetailContextConfig }>(
  ({ children, config = {} }) => {
    return <DetailContext value={config}>{children}</DetailContext>;
  },
);

export const useDetailContext = () => {
  return use(DetailContext);
};
