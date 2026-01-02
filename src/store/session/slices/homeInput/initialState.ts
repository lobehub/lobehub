export type StarterMode = 'agent' | 'write' | 'image' | 'research' | null;

export interface HomeInputState {
  homeInputLoading: boolean;
  inputActiveMode: StarterMode;
}

export const initialHomeInputState: HomeInputState = {
  homeInputLoading: false,
  inputActiveMode: null,
};
