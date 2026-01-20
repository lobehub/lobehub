'use client';

import { type ReactNode, createContext, memo, useCallback, useContext, useState } from 'react';

export type FaviconState = 'default' | 'done' | 'error' | 'progress';

interface FaviconContextValue {
  currentState: FaviconState;
  isDevMode: boolean;
  setFavicon: (state: FaviconState) => void;
  setIsDevMode: (isDev: boolean) => void;
}

const FaviconContext = createContext<FaviconContextValue | null>(null);

export const useFavicon = () => {
  const context = useContext(FaviconContext);
  if (!context) {
    throw new Error('useFavicon must be used within FaviconProvider');
  }
  return context;
};

const stateToFileName: Record<FaviconState, string> = {
  default: '',
  done: '-done',
  error: '-error',
  progress: '-progress',
};

const getFaviconPath = (state: FaviconState, isDev: boolean, size?: '32x32'): string => {
  const devSuffix = isDev ? '-dev' : '';
  const stateSuffix = stateToFileName[state];
  const sizeSuffix = size ? `-${size}` : '';
  return `/favicon${sizeSuffix}${stateSuffix}${devSuffix}.ico`;
};

const updateFaviconDOM = (state: FaviconState, isDev: boolean) => {
  if (typeof document === 'undefined') return;

  const head = document.head;
  const existingLinks = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]',
  );

  // Remove existing favicon links and create new ones to bust cache
  existingLinks.forEach((link) => {
    const oldHref = link.href;
    const is32 = oldHref.includes('32x32');
    const rel = link.rel;

    // Remove old link
    link.remove();

    // Create new link with cache-busting query param
    const newLink = document.createElement('link');
    newLink.rel = rel;
    newLink.href = `${getFaviconPath(state, isDev, is32 ? '32x32' : undefined)}?v=${Date.now()}`;
    head.append(newLink);
  });
};

const defaultIsDev = process.env.NODE_ENV === 'development';

export const FaviconProvider = memo<{ children: ReactNode }>(({ children }) => {
  const [currentState, setCurrentState] = useState<FaviconState>('default');
  const [isDevMode, setIsDevModeState] = useState<boolean>(defaultIsDev);

  const setFavicon = useCallback(
    (state: FaviconState) => {
      setCurrentState(state);
      updateFaviconDOM(state, isDevMode);
    },
    [isDevMode],
  );

  const setIsDevMode = useCallback(
    (isDev: boolean) => {
      setIsDevModeState(isDev);
      updateFaviconDOM(currentState, isDev);
    },
    [currentState],
  );

  return (
    <FaviconContext.Provider value={{ currentState, isDevMode, setFavicon, setIsDevMode }}>
      {children}
    </FaviconContext.Provider>
  );
});

FaviconProvider.displayName = 'FaviconProvider';
