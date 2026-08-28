import type { State } from '../store/initialState';

export const isOtherAudioInputModeActive = (
  activeMode: State['activeAudioInputMode'],
  ownMode: NonNullable<State['activeAudioInputMode']>,
) => activeMode !== undefined && activeMode !== ownMode;
