export interface AudioGenerationConfigState {
  /**
   * Music style: pop|rock|jazz|lo-fi|classical|ambient|hip-hop
   */
  musicStyle: string;

  /**
   * Duration in seconds (15-120)
   */
  duration: number;

  /**
   * Model version (default: v5.5)
   */
  modelVersion: string;

  /**
   * Marks whether the configuration has been initialized
   */
  isInit: boolean;
}

export const initialGenerationConfigState: AudioGenerationConfigState = {
  musicStyle: 'ambient',
  duration: 30,
  modelVersion: 'v5.5',
  isInit: false,
};
