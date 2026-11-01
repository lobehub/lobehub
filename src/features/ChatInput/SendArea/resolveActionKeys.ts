import type { ActionKey } from '../ActionBar/config';
import type { State } from '../store/initialState';

/**
 * Resolve which right actions the SendArea itself renders.
 *
 * `contextWindow` is normally hosted by the ControlBar row below the composer,
 * so the SendArea strips it to avoid a double render. Composers without a
 * ControlBar (mobile, floating panel) have no other host, so they keep it
 * beside the Send button.
 *
 * Active audio controls stay in the region where their action is configured.
 * If dictation is a left action, SendArea must not render a duplicate copy on
 * the right while the session is active.
 */
export const resolveSendAreaActionKeys = (
  rightActions: ActionKey[] | undefined,
  hideContextWindow: boolean,
  activeAudioInputMode?: State['activeAudioInputMode'],
): ActionKey[] => {
  const keys = rightActions || [];

  if (activeAudioInputMode) {
    const activeActionKey =
      activeAudioInputMode === 'dictation' ? 'voiceDictation' : 'voiceMessage';

    return keys.includes(activeActionKey) ? [activeActionKey] : [];
  }

  return hideContextWindow ? keys.filter((actionKey) => actionKey !== 'contextWindow') : keys;
};
