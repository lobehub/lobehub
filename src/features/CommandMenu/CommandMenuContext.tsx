'use client';

import { type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { createContext, use, useCallback, useMemo, useState } from 'react';

import { type MenuContext, type PageType, type SelectedAgent } from './types';
import { detectContext } from './utils/context';
import { type ValidSearchType } from './utils/queryParser';

interface CommandMenuContextValue {
  menuContext: MenuContext;
  mounted: boolean;
  onClose: () => void;
  page: PageType | undefined;
  pages: PageType[];
  pathname: string | null;
  search: string;
  selectedAgent: SelectedAgent | undefined;
  setPages: Dispatch<SetStateAction<PageType[]>>;
  setSearch: (search: string) => void;
  setSelectedAgent: (agent: SelectedAgent | undefined) => void;
  setTypeFilter: (typeFilter: ValidSearchType | undefined) => void;
  setViewMode: (viewMode: MenuViewMode) => void;
  typeFilter: ValidSearchType | undefined;
  viewMode: MenuViewMode;
}

type MenuViewMode = 'default' | 'search';

const CommandMenuContext = createContext<CommandMenuContextValue | undefined>(undefined);

interface CommandMenuProviderProps {
  children: ReactNode;
  onClose: () => void;
  pathname: string | null;
}

export const CommandMenuProvider = ({ children, onClose, pathname }: CommandMenuProviderProps) => {
  const [pages, setPages] = useState<PageType[]>([]);
  const [search, setSearchState] = useState('');
  const [typeFilter, setTypeFilterState] = useState<ValidSearchType | undefined>(undefined);
  const [selectedAgent, setSelectedAgentState] = useState<SelectedAgent | undefined>(undefined);

  // Memoize derived values
  const menuContext = useMemo(() => detectContext(pathname ?? '/'), [pathname]);
  const page = pages.at(-1);
  const viewMode: MenuViewMode = search.trim().length > 0 ? 'search' : 'default';

  // Memoize setters to maintain stable references
  const setSearch = useCallback((value: string) => setSearchState(value), []);
  const setTypeFilter = useCallback(
    (value: ValidSearchType | undefined) => setTypeFilterState(value),
    [],
  );
  const setSelectedAgent = useCallback(
    (value: SelectedAgent | undefined) => setSelectedAgentState(value),
    [],
  );
  const setViewMode = useCallback(() => {
    // viewMode is now derived from search, this is a no-op for backwards compatibility
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo<CommandMenuContextValue>(
    () => ({
      menuContext,
      mounted: true, // Always true after initial render since provider only mounts on client
      onClose,
      page,
      pages,
      pathname,
      search,
      selectedAgent,
      setPages,
      setSearch,
      setSelectedAgent,
      setTypeFilter,
      setViewMode,
      typeFilter,
      viewMode,
    }),
    [
      menuContext,
      onClose,
      page,
      pages,
      pathname,
      search,
      selectedAgent,
      setSearch,
      setSelectedAgent,
      setTypeFilter,
      setViewMode,
      typeFilter,
      viewMode,
    ],
  );

  return <CommandMenuContext value={contextValue}>{children}</CommandMenuContext>;
};

export const useCommandMenuContext = () => {
  const context = use(CommandMenuContext);
  if (context === undefined) {
    throw new Error('useCommandMenuContext must be used within a CommandMenuProvider');
  }
  return context;
};
