export { buildResourcesTreeText, resourcesTreePrompt } from './resourcesTree';

export interface SkillItem {
  description: string;
  identifier: string;
  location?: string;
  name: string;
}

export const skillPrompt = (skill: SkillItem) =>
  skill.location
    ? `  <skill name="${skill.name}" location="${skill.location}">${skill.description}</skill>`
    : `  <skill name="${skill.name}">${skill.description}</skill>`;

export const skillsPrompts = (skills: SkillItem[]) => {
  if (skills.length === 0) return '';

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');

  return `<available_skills>
${skillTags}
</available_skills>

Use the runSkill tool to activate a skill when needed.`;
};
