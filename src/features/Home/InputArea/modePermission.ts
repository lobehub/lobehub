import type { HomeMode } from '../types';

export const isHomeModeDisabled = (mode: HomeMode, canCreateContent: boolean): boolean =>
  mode === 'task' && !canCreateContent;

export const resolvePermittedHomeMode = (mode: HomeMode, canCreateContent: boolean): HomeMode =>
  isHomeModeDisabled(mode, canCreateContent) ? 'chat' : mode;
