import { type AudioGenerationConfigState } from './initialState';

export const musicStyle = (s: AudioGenerationConfigState) => s.musicStyle;
export const duration = (s: AudioGenerationConfigState) => s.duration;
export const modelVersion = (s: AudioGenerationConfigState) => s.modelVersion;
export const isInit = (s: AudioGenerationConfigState) => s.isInit;

export const audioGenerationConfigSelectors = {
  musicStyle,
  duration,
  modelVersion,
  isInit,
};
