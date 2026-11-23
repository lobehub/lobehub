import { describe, expect, it } from 'vitest';

import type { ActionKey, ActionKeys } from '../ActionBar/config';
import {
  resolveLeftActionsForVoicePlacement,
  resolveRightActionsForVoicePlacement,
} from './resolveVoiceActionPlacement';

describe('resolveVoiceActionPlacement', () => {
  const leftActions: ActionKeys[] = ['plus', 'voiceDictation'];
  const rightActions: ActionKey[] = ['model', 'voiceMessage', 'contextWindow'];

  it('moves voiceDictation into the voiceMessage right slot when voice messages are disabled', () => {
    expect(resolveLeftActionsForVoicePlacement(leftActions, rightActions, false)).toEqual(['plus']);
    expect(resolveRightActionsForVoicePlacement(leftActions, rightActions, false)).toEqual([
      'model',
      'voiceDictation',
      'contextWindow',
    ]);
  });

  it('keeps voiceDictation on the left and voiceMessage on the right when voice messages are enabled', () => {
    expect(resolveLeftActionsForVoicePlacement(leftActions, rightActions, true)).toEqual(
      leftActions,
    );
    expect(resolveRightActionsForVoicePlacement(leftActions, rightActions, true)).toEqual(
      rightActions,
    );
  });

  it('handles composers with grouped left actions', () => {
    const groupLeft: ActionKeys[] = [
      'search',
      'memory',
      'fileUpload',
      'tools',
      'voiceDictation',
      '---',
      ['typo', 'params', 'clear'],
    ];

    expect(resolveLeftActionsForVoicePlacement(groupLeft, rightActions, false)).toEqual([
      'search',
      'memory',
      'fileUpload',
      'tools',
      '---',
      ['typo', 'params', 'clear'],
    ]);
  });

  it('leaves composers unchanged when either voice action is not configured', () => {
    expect(resolveLeftActionsForVoicePlacement(['plus'], rightActions, false)).toEqual(['plus']);
    expect(resolveRightActionsForVoicePlacement(['plus'], rightActions, false)).toEqual(
      rightActions,
    );
    expect(resolveLeftActionsForVoicePlacement(leftActions, ['model'], false)).toEqual(leftActions);
    expect(resolveRightActionsForVoicePlacement(leftActions, ['model'], false)).toEqual(['model']);
  });
});
