import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export const SkillCreatorIdentifier = 'skill-creator';

export const SkillCreatorSkill: BuiltinSkill = {
  content: systemPrompt,
  description:
    'Guide for creating effective skills. Use when users want to create or update a skill that extends agent capabilities with specialized knowledge, workflows, or tool integrations.',
  identifier: SkillCreatorIdentifier,
  name: 'Skill Creator',
  source: 'builtin',
};
