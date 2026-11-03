import { type DependencyList } from 'react';
import { useCallback } from 'react';

export const useTypeScriptHappyCallback: <Args extends unknown[], R>(
  fn: (...args: Args) => R,
  deps: DependencyList,
) => (...args: Args) => R = useCallback;
