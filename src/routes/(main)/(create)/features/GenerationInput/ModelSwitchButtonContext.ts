'use client';

import { createContext, useContext } from 'react';

export interface ModelSwitchButtonContextValue {
  onClose: () => void;
}

export const ModelSwitchButtonContext = createContext<ModelSwitchButtonContextValue | null>(null);

export const useModelSwitchButtonContext = () => {
  const ctx = useContext(ModelSwitchButtonContext);
  return ctx;
};
