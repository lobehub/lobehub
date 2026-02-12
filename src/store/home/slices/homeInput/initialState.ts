import { type NavigateFunction } from 'react-router-dom';

export type StarterMode = 'agent' | 'group' | 'write' | 'research' | null;

export interface HomeInputState {
  homeInputLoading: boolean;
  inputActiveMode: StarterMode;
  navigate?: NavigateFunction;
}

export const initialHomeInputState: HomeInputState = {
  homeInputLoading: false,
  inputActiveMode: null,
  navigate: undefined,
};
