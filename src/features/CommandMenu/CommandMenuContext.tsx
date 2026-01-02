'use client';

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';

import { type MenuContext, type PageType } from './types';
import { detectContext } from './utils/context';
import type { ValidSearchType } from './utils/queryParser';

interface CommandMenuContextValue {
  menuContext: MenuContext;
  mounted: boolean;
  page: PageType | undefined;
  pages: PageType[];
  pathname: string | null;
  search: string;
  setPages: Dispatch<SetStateAction<PageType[]>>;
  setSearch: (search: string) => void;
  setTypeFilter: (typeFilter: ValidSearchType | undefined) => void;
  setViewMode: (viewMode: MenuViewMode) => void;
  typeFilter: ValidSearchType | undefined;
  viewMode: MenuViewMode;
}

type MenuViewMode = 'default' | 'search';

const CommandMenuContext = createContext<CommandMenuContextValue | undefined>(undefined);

interface CommandMenuProviderProps {
  children: ReactNode;
  pathname: string | null;
}

export const CommandMenuProvider = ({ children, pathname }: CommandMenuProviderProps) => {
  const menuContext = detectContext(pathname ?? '/');
  const [viewMode, setViewMode] = useState<MenuViewMode>('default');
  const [pages, setPages] = useState<PageType[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<ValidSearchType | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  // Derived values
  const page = pages.at(-1);

  // Ensure we're mounted on the client
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (search.trim().length > 0) {
      setViewMode('search');
    } else {
      setViewMode('default');
    }
  }, [search]);

  return (
    <CommandMenuContext.Provider
      value={{
        menuContext,
        mounted,
        page,
        pages,
        pathname,
        search,
        setPages,
        setSearch,
        setTypeFilter,
        setViewMode,
        typeFilter,
        viewMode,
      }}
    >
      {children}
    </CommandMenuContext.Provider>
  );
};

export const useCommandMenuContext = () => {
  const context = useContext(CommandMenuContext);
  if (context === undefined) {
    throw new Error('useCommandMenuContext must be used within a CommandMenuProvider');
  }
  return context;
};
