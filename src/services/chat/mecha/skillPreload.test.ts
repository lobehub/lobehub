import { describe, expect, it, vi } from 'vitest';

import * as toolStoreModule from '@/store/tool';

import { prepareSelectedSkillPreload } from './skillPreload';

describe('prepareSelectedSkillPreload', () => {
  it('should sanitize skill action tags and build persisted preload messages', async () => {
    vi.spyOn(toolStoreModule, 'getToolStoreState').mockReturnValue({
      agentSkillDetailMap: {},
      agentSkills: [],
      builtinSkills: [
        {
          content: 'Use grep to search the codebase.',
          description: 'Search code with ripgrep',
          identifier: 'grep',
          name: 'Grep',
          source: 'builtin',
        },
      ],
    } as any);

    const result = await prepareSelectedSkillPreload({
      message: '<action type="grep" category="skill" /> hi',
      selectedSkills: [{ identifier: 'grep', name: 'Grep' }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        content: '',
        role: 'assistant',
        tools: [
          expect.objectContaining({
            apiName: 'activateSkill',
            arguments: JSON.stringify({ name: 'Grep' }),
            id: expect.any(String),
            identifier: 'lobe-activator',
            type: 'builtin',
          }),
        ],
      }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        content: 'Use grep to search the codebase.',
        plugin: expect.objectContaining({
          apiName: 'activateSkill',
          arguments: JSON.stringify({ name: 'Grep' }),
          identifier: 'lobe-activator',
          type: 'builtin',
        }),
        role: 'tool',
        tool_call_id: result[0].tools?.[0].id,
      }),
    );
  });
});
