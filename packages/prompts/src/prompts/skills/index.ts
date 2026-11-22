export { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

export type SkillSource = 'builtin' | 'device' | 'project' | 'user';

export interface SkillItem {
  description: string;
  identifier: string;
  location?: string;
  name: string;
  /**
   * Where the skill comes from. `project` and `device` skills live on the
   * execution device filesystem; `activateSkill` loads them by name and
   * `location` gives their absolute path for resolving relative paths.
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
    ? `\nFor a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile) and resolve relative paths against the parent directory of its \`location\` (parent of SKILL.md).`
    : '';

  return `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.${filesystemHint}

<available_skills>
${skillTags}
</available_skills>`;
};
