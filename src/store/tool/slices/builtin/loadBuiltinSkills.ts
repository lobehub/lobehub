import type { BuiltinSkill } from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';

let loading: Promise<BuiltinSkill[]> | undefined;

export const loadBuiltinSkills = () => {
  loading ??= import('@lobechat/builtin-skills').then((m) => filterBuiltinSkills(m.builtinSkills));
  return loading;
};

export const loadBuiltinSkill = async (identifier: string) =>
  (await loadBuiltinSkills()).find((skill) => skill.identifier === identifier);
