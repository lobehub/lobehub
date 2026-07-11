/**
 * Project/device filesystem skills (SKILL.md on the execution device) from the
 * operation's skill set, shaped for the tool-execution context. Shared by
 * `callTool` and `callToolsBatch` so batched device `execScript` calls resolve
 * the same SKILL.md cwd as single calls — an unshared copy is exactly how the
 * batch path silently dropped these fields once already.
 */
export const resolveRunProjectSkills = (metadata?: {
  operationSkillSet?: { skills?: { location?: string; name: string; source?: string }[] };
}): { location: string; name: string; source: 'device' | 'project' }[] =>
  (metadata?.operationSkillSet?.skills ?? [])
    .filter(
      (skill) => (skill.source === 'project' || skill.source === 'device') && !!skill.location,
    )
    .map((skill) => ({
      location: skill.location as string,
      name: skill.name,
      source: skill.source === 'device' ? ('device' as const) : ('project' as const),
    }));
