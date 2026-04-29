/** Stable identifier for the system-only skill maintainer builtin tool. */
export const SkillMaintainerIdentifier = 'lobe-skill-maintainer';

/** API names exposed by the system-only skill maintainer builtin tool. */
export const SkillMaintainerApiName = {
  consolidate: 'consolidate',
  readSkillFile: 'readSkillFile',
  refine: 'refine',
  removeSkillFile: 'removeSkillFile',
  updateSkill: 'updateSkill',
  writeSkillFile: 'writeSkillFile',
} as const;
