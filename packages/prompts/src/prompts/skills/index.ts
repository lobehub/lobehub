export { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

export type SkillSource = 'builtin' | 'device' | 'project' | 'user';

export interface SkillItem {
  description: string;
  identifier: string;
  location?: string;
  name: string;
  /**
   * Where the skill comes from. `project` and `device` skills live on the
   * execution device filesystem and `location` carries their absolute path so
   * the model can load them via the readFile tool.
   */
  source?: SkillSource;
}

export const skillPrompt = (skill: SkillItem) => {
  const attrs = [`name="${skill.name}"`];
  if (skill.source) attrs.push(`source="${skill.source}"`);
  if (skill.location) attrs.push(`location="${skill.location}"`);
  return `  <skill ${attrs.join(' ')}>${skill.description}</skill>`;
};

export const skillsPrompts = (skills: SkillItem[]) => {
  if (skills.length === 0) return '';

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');

  const hasFilesystemSkill = skills.some(
    (skill) => skill.source === 'project' || skill.source === 'device',
  );
  const filesystemHint = hasFilesystemSkill
    ? `\nFor a skill with source="project" or source="device", load it by calling the readFile tool on its \`location\` path before following its instructions.`
    : '';

  return `<available_skills>
${skillTags}
</available_skills>

Use the runSkill tool to activate a skill when needed.${filesystemHint}`;
};
