import { createContext, type PropsWithChildren, use, useState } from 'react';

const AgentSearchContext = createContext<{
  keywords: string;
  setKeywords: (keywords: string) => void;
} | null>(null);

export const AgentSearchProvider = ({ children }: PropsWithChildren) => {
  const [keywords, setKeywords] = useState('');
  return <AgentSearchContext value={{ keywords, setKeywords }}>{children}</AgentSearchContext>;
};

export const useAgentSearch = () => {
  const context = use(AgentSearchContext);
  if (!context) throw new Error('AgentSearchProvider is required');
  return context;
};
