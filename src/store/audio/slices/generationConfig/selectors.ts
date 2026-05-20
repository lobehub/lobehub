import { type AudioGenerationConfigState } from './initialState';

export const audioGenerationConfigSelectors = {
  customMode: (s: AudioGenerationConfigState) => s.customMode,
  prompt: (s: AudioGenerationConfigState) => s.prompt,
  songTitle: (s: AudioGenerationConfigState) => s.songTitle,
  stylePrompt: (s: AudioGenerationConfigState) => s.stylePrompt,
  makeInstrumental: (s: AudioGenerationConfigState) => s.makeInstrumental,
  isInit: (s: AudioGenerationConfigState) => s.isInit,
};
