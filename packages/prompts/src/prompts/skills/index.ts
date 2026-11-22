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
   * `location` gives their absolute path for resolving relative paths, and
   * for reading SKILL.md directly in a run that has no `activateSkill`.
   */
  source?: SkillSource;
}

export const skillPrompt = (skill: SkillItem) => {
  const attrs = [`name="${skill.name}"`];
  if (skill.source) attrs.push(`source="${skill.source}"`);
  if (skill.location) attrs.push(`location="${skill.location}"`);
  return `  <skill ${attrs.join(' ')}>${skill.description}</skill>`;
};

export interface SkillsPromptOptions {
  /**
   * Whether this run was sent the `activateSkill` tool. A run without it (a
   * Custom-mode agent or a goal turn that did not pin Skills) can still open a
   * filesystem skill by reading its SKILL.md. Defaults to true.
   */
  canActivateSkill?: boolean;
}

export const skillsPrompts = (skills: SkillItem[], options: SkillsPromptOptions = {}) => {
  if (skills.length === 0) return '';

  const { canActivateSkill = true } = options;

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');

  const hasFilesystemSkill = skills.some(
    (skill) => skill.source === 'project' || skill.source === 'device',
  );
  // Activation records the skill for the run, which is how `execScript` finds
  // its directory, so it is the way in whenever the tool was sent. Reading the
  // file is the only way left when it was not.
  const filesystemHint = !hasFilesystemSkill
    ? ''
    : canActivateSkill
      ? `\nFor a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile) and resolve relative paths against the parent directory of its \`location\` (parent of SKILL.md).`
      : `\nFor a skill with source="project" or source="device", load it by calling the readFile tool on its \`location\` path and resolve relative paths against its parent directory (parent of SKILL.md).`;

  return `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.${filesystemHint}

<available_skills>
${skillTags}
</available_skills>`;
};
