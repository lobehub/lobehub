import type { BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export const FindSkillsIdentifier = 'find-skills';

export const FindSkillsSkill: BuiltinSkill = {
  content: systemPrompt,
  description:
    'Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", or express interest in extending capabilities',
  identifier: FindSkillsIdentifier,
  name: 'Find Skills',
};
