'use client';

import { createContext, type PropsWithChildren, use, useMemo, useState } from 'react';

interface MessageSearchState {
  query: string;
  setQuery: (query: string) => void;
}

const MessageSearchContext = createContext<MessageSearchState>({ query: '', setQuery: () => {} });

/** Shares the list header's search box with the conversation rows below it. */
export const MessageSearchProvider = ({ children }: PropsWithChildren) => {
  const [query, setQuery] = useState('');
  const value = useMemo(() => ({ query, setQuery }), [query]);

  return <MessageSearchContext value={value}>{children}</MessageSearchContext>;
};

export const useMessageSearch = () => use(MessageSearchContext);
