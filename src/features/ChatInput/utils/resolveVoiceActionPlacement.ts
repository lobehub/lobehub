import type { ActionKey, ActionKeys } from '../ActionBar/config';

const hasActionKey = (actions: ActionKeys[] | undefined, target: ActionKey): boolean =>
  Boolean(actions?.some((item) => (Array.isArray(item) ? item.includes(target) : item === target)));

/**
 * When voice messages are off (the default), promote the left-side dictation
 * button into the voice-message slot beside Send. Once voice messages are
 * turned on, keep the configured left/right split so both buttons stay visible
 * on their own sides.
 */
export const shouldPromoteDictationToRight = (
  leftActions: ActionKeys[] | undefined,
  rightActions: ActionKeys[] | undefined,
  enableVoiceMessage: boolean,
): boolean =>
  !enableVoiceMessage &&
  hasActionKey(leftActions, 'voiceDictation') &&
  hasActionKey(rightActions, 'voiceMessage');

export const resolveLeftActionsForVoicePlacement = (
  leftActions: ActionKeys[],
  rightActions: ActionKeys[] | undefined,
  enableVoiceMessage: boolean,
): ActionKeys[] => {
  if (!shouldPromoteDictationToRight(leftActions, rightActions, enableVoiceMessage)) {
    return leftActions;
  }

  const result: ActionKeys[] = [];
  for (const item of leftActions) {
    if (Array.isArray(item)) {
      const next = item.filter((key) => key !== 'voiceDictation');
      if (next.length > 0) result.push(next);
    } else if (item !== 'voiceDictation') {
      result.push(item);
    }
  }

  return result;
};

export const resolveRightActionsForVoicePlacement = (
  leftActions: ActionKeys[] | undefined,
  rightActions: ActionKey[] | undefined,
  enableVoiceMessage: boolean,
): ActionKey[] => {
  const keys = rightActions || [];
  if (!shouldPromoteDictationToRight(leftActions, keys, enableVoiceMessage)) {
    return keys;
  }

  return keys.map((key) => (key === 'voiceMessage' ? 'voiceDictation' : key));
};
