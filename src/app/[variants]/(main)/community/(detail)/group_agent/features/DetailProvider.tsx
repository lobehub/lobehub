import { type FC, type PropsWithChildren, createContext, useContext } from 'react';

interface GroupAgentDetailData {
  author?: {
    avatar?: string;
    name?: string;
    userName?: string;
  };
  currentVersion?: {
    avatar?: string;
    backgroundColor?: string;
    category?: string;
    config?: Record<string, any>;
    description?: string;
    name: string;
    tags?: string[];
    version?: string;
    versionNumber?: number;
  };
  group: {
    commentCount?: number;
    createdAt: string;
    favoriteCount?: number;
    homepage?: string;
    identifier: string;
    installCount?: number;
    isFeatured?: boolean;
    isOfficial?: boolean;
    likeCount?: number;
    name: string;
    ownerId?: number;
    status?: string;
    updatedAt: string;
    visibility?: string;
  };
  locale?: string;
  memberAgents: Array<{
    agent: {
      displayOrder?: number;
      enabled?: boolean;
      identifier: string;
      name: string;
      role: 'supervisor' | 'participant';
    };
    currentVersion: {
      avatar?: string;
      config?: Record<string, any>;
      description?: string;
      name: string;
      tokenUsage?: number;
      url: string;
      version?: string;
    };
  }>;
  versions?: Array<{
    isLatest?: boolean;
    status?: string;
    updatedAt: string;
    version: string;
    versionNumber: number;
  }>;
}

const DetailContext = createContext<GroupAgentDetailData | null>(null);

export const useDetailData = () => {
  const context = useContext(DetailContext);
  if (!context) {
    throw new Error('useDetailData must be used within DetailProvider');
  }
  return context;
};

interface DetailProviderProps extends PropsWithChildren {
  config: GroupAgentDetailData;
}

const DetailProvider: FC<DetailProviderProps> = ({ config, children }) => {
  return <DetailContext.Provider value={config}>{children}</DetailContext.Provider>;
};

export default DetailProvider;
