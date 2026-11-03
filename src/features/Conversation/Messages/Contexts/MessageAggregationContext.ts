import { createContext, useContext } from 'react';

interface GroupMessageContextValue {
  assistantGroupId: string;
}

export const MessageAggregationContext = createContext<GroupMessageContextValue | null>(null);

export const useMessageAggregationContext = () => {
  const context = useContext(MessageAggregationContext);
  if (!context) {
    throw new Error('useMessageAggregationContext must be used within MessageAggregationContext');
  }
  return context;
};
