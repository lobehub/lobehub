import { AgentPluginEntrySchema, getBuiltinOverrides, setBuiltinPluginMode } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getLegacyDisabledBuiltinSkillIds } from './builtinSkillGate';

describe('agent-scoped builtin skill choices', () => {
  const id = 'lobe-artifacts';
  const oldUninstalls = [id, 'some-tool'];

  it('keeps previous installs and implicit defaults off until this agent chooses again', () => {
    for (const plugins of [[], [id], [{ identifier: id, mode: 'auto' as const }]]) {
      expect(getLegacyDisabledBuiltinSkillIds(oldUninstalls, getBuiltinOverrides(plugins))).toEqual(
        [id],
      );
    }
  });

  it('round trips a new choice, independently of other agents and ordinary tools', () => {
    const oldPlugins = ['unrelated', id];
    const next = setBuiltinPluginMode(oldPlugins, id, 'auto').map((item) =>
      AgentPluginEntrySchema.parse(item),
    );
    expect(next[0]).toBe('unrelated');
    expect(getLegacyDisabledBuiltinSkillIds(oldUninstalls, getBuiltinOverrides(next))).toEqual([]);
    expect(
      getLegacyDisabledBuiltinSkillIds(oldUninstalls, getBuiltinOverrides(oldPlugins)),
    ).toEqual([id]);
    expect(setBuiltinPluginMode(next, id, 'disabled')[1]).toMatchObject({
      identifier: id,
      mode: 'disabled',
    });
  });
});
