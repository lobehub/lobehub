import { type BuiltinSkill } from '@lobechat/types';
import { type TFunction } from 'i18next';

type Translate = TFunction<'setting'>;

export const getLocalizedBuiltinSkillDetail = (
  builtinSkill: BuiltinSkill | undefined,
  identifier: string,
  t: Translate,
) => {
  if (!builtinSkill) {
    return { description: undefined, title: identifier };
  }

  return {
    description: builtinSkill.description
      ? t(`tools.builtins.${builtinSkill.identifier}.description`, {
          defaultValue: builtinSkill.description,
        })
      : undefined,
    title: t(`tools.builtins.${builtinSkill.identifier}.title`, {
      defaultValue: builtinSkill.name,
    }),
  };
};

export const getNoPermissionsTitle = (identifier: string, type: string, t: Translate) => {
  if (type !== 'builtin') return identifier;

  return t(`tools.builtins.${identifier}.title`, { defaultValue: identifier });
};
