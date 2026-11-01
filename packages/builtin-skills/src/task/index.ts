import type { BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../lobehub/helpers';
import { TaskIdentifier, TaskManifest } from './manifest';
import commands from './references/commands.md';
import content from './SKILL.md';

export { TaskIdentifier };

export const TaskSkill: BuiltinSkill = {
  ...TaskManifest,
  content,
  resources: toResourceMeta({
    'references/commands': commands,
  }),
};
