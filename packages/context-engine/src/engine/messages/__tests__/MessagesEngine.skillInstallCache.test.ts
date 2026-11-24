import { describe, expect, it } from 'vitest';

import type { SkillMeta } from '../../../providers/SkillContextProvider';
import { MessagesEngine } from '../MessagesEngine';

const existingSkills: SkillMeta[] = [
  { description: 'Document writer', identifier: 'doc-writer', name: 'doc-writer' },
  { description: 'Chart generator', identifier: 'chart-maker', name: 'chart-maker' },
];

const installedPptxSkill: SkillMeta = {
  description: 'Create and edit PowerPoint presentations',
  identifier: 'market-pptx',
  name: 'pptx',
};

describe('MessagesEngine — skill install prompt-cache stability', () => {
  it('keeps the leading system message byte-identical on the turn after lobe-skill-store creates a skill', async () => {
    const baseParams = {
      enableAgentMode: true,
      enableSystemDate: false,
      model: 'deepseek-flash',
      provider: 'lobehub',
      systemRole: 'You are a helpful assistant.',
    };

    const turn1 = await new MessagesEngine({
      ...baseParams,
      messages: [{ content: 'Install pptx', id: 'u1', role: 'user' }] as any[],
      skillsConfig: { enabledSkills: existingSkills },
    }).process();

    // Next operation: DB now returns the newly created `pptx` skill first (updatedAt DESC),
    // while Turn 1's grouped import result is still in visible history.
    const turn2 = await new MessagesEngine({
      ...baseParams,
      messages: [
        { content: 'Install pptx', id: 'u1', role: 'user' },
        {
          children: [
            {
              content: '',
              id: 'a1',
              tools: [
                {
                  apiName: 'importFromMarket',
                  arguments: JSON.stringify({ identifier: 'market-pptx' }),
                  id: 'call_import_1',
                  identifier: 'lobe-skill-store',
                  result: {
                    content: 'Skill "pptx" created successfully from market.',
                    state: {
                      name: 'pptx',
                      skillId: 'skl_pptx',
                      status: 'created',
                      success: true,
                    },
                  },
                },
              ],
            },
            { content: 'Installed pptx.', id: 'a2' },
          ],
          content: '',
          id: 'g1',
          role: 'assistantGroup',
        },
        { content: 'Build a 10-slide Q4 review deck', id: 'u2', role: 'user' },
      ] as any[],
      skillsConfig: { enabledSkills: [installedPptxSkill, ...existingSkills] },
    }).process();

    expect(turn2.messages[0]).toEqual(turn1.messages[0]);
    expect(turn2.messages[0].content).not.toContain('<skill name="pptx">');
  });

  it('restores the session-created skill into <available_skills> once history truncation drops the import turn', async () => {
    const result = await new MessagesEngine({
      enableAgentMode: true,
      enableHistoryCount: true,
      enableSystemDate: false,
      historyCount: 1,
      messages: [
        { content: 'Install pptx', id: 'u1', role: 'user' },
        {
          content: 'Skill "pptx" created successfully from market.',
          id: 't1',
          plugin: { apiName: 'importFromMarket', identifier: 'lobe-skill-store' },
          pluginState: { name: 'pptx', skillId: 'skl_pptx', status: 'created', success: true },
          role: 'tool',
        },
        { content: 'Build a deck', id: 'u2', role: 'user' },
      ] as any[],
      model: 'deepseek-flash',
      provider: 'lobehub',
      skillsConfig: { enabledSkills: [installedPptxSkill, ...existingSkills] },
      systemRole: 'You are a helpful assistant.',
    }).process();

    expect(result.messages[0].content).toContain('<skill name="pptx">');
  });
});
