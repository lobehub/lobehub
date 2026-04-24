import { createContext, type ReactNode, useContext } from 'react';

interface WelcomeExtraValue {
  extra?: ReactNode;
}

const WelcomeExtraContext = createContext<WelcomeExtraValue>({});

export const WelcomeExtraProvider = WelcomeExtraContext.Provider;

export const useWelcomeExtra = () => useContext(WelcomeExtraContext).extra;
