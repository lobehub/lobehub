import { createContext } from 'react';

interface LoadingContextValue {
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export const LoadingContext = createContext<LoadingContextValue>({
  loading: false,
  setLoading: () => {},
});
