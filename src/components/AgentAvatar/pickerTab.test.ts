import { getAgentAvatarTraits } from '@lobehub/ui';
import { describe, expect, it } from 'vitest';

import { agentAvatarPickerDefault } from './pickerTab';

describe('agentAvatarPickerDefault', () => {
  it('opens on the character the agent picked', () => {
    expect(agentAvatarPickerDefault('agent-avatar:rocket:cyan', 'agt_1')).toEqual({
      color: 'cyan',
      shape: 'rocket',
    });
  });

  // Opening the picker on an empty selection would hide which character the agent wears now.
  it('opens on the character its id generates when none was picked', () => {
    const { color, shape } = getAgentAvatarTraits('agt_1');

    expect(agentAvatarPickerDefault(undefined, 'agt_1')).toEqual({ color, shape });
    expect(agentAvatarPickerDefault('🤖', 'agt_1')).toEqual({ color, shape });
  });

  it('has nothing to open on without a pick or an id', () => {
    expect(agentAvatarPickerDefault(undefined)).toBeUndefined();
  });
});
