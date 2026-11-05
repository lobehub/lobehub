import { GoalIdentifier } from '@lobechat/builtin-tool-goal';
import { MiniGameIdentifier } from '@lobechat/builtin-tool-mini-game';
import type { ContextSelection } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { appendAutoSelectedTools } from './autoSelectedTools';

const gameSelection: ContextSelection = {
  content: '<game_state/>',
  id: 'game:pixel-yard',
  sceneId: 'pixel-yard',
  source: 'game',
};

describe('appendAutoSelectedTools', () => {
  it('enables the mini game tool only when the game snapshot rides along', () => {
    expect(
      appendAutoSelectedTools([], {
        contextSelections: [gameSelection],
        message: '去椅子上坐会儿',
      }),
    ).toEqual([{ identifier: MiniGameIdentifier, name: 'Mini Game' }]);

    expect(
      appendAutoSelectedTools([], {
        contextSelections: [{ content: 'x', id: 't', source: 'text' }],
        message: '去椅子上坐会儿',
      }),
    ).toEqual([]);
    expect(appendAutoSelectedTools([], { message: '去椅子上坐会儿' })).toEqual([]);
  });

  it('keeps the user picks and does not duplicate a tool', () => {
    const picked = [{ identifier: MiniGameIdentifier, name: 'Mini Game' }];
    expect(
      appendAutoSelectedTools(picked, { contextSelections: [gameSelection], message: 'hi' }),
    ).toEqual(picked);
  });

  it('still enables the goal tool for a /goal prompt', () => {
    expect(appendAutoSelectedTools([], { message: '/goal ship it' })).toEqual([
      { identifier: GoalIdentifier, name: 'Goal' },
    ]);
  });
});
