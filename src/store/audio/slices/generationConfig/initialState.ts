export interface AudioGenerationConfigState {
  /** Whether custom mode is active (user provides lyrics + style vs AI-generated) */
  customMode: boolean;
  /** Song description (non-custom) or song lyrics (custom mode) */
  prompt: string;
  /** Song title — only used in custom mode */
  songTitle: string;
  /** Music style tags — only used in custom mode, e.g. "pop rock energetic" */
  stylePrompt: string;
  /** Whether to generate instrumental (no vocals) */
  makeInstrumental: boolean;
  /** Marks whether the configuration has been initialized */
  isInit: boolean;
}

export const initialGenerationConfigState: AudioGenerationConfigState = {
  customMode: false,
  prompt: '',
  songTitle: '',
  stylePrompt: '',
  makeInstrumental: false,
  isInit: false,
};
