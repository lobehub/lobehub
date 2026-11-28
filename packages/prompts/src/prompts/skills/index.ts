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

/**
 * Character budget of the whole `<available_skills>` prompt, about 13K tokens.
 *
 * The list has no natural size limit: a device can carry hundreds of SKILL.md
 * files, and rendering 483 of them in full took ~65K tokens, enough on its own
 * to push a plain "Hello" past a 64K context window (lobehub#22284). A list
 * within the budget renders exactly as before; a larger one switches to the
 * compact form built by {@link compactSkillTags}.
 */
export const SKILLS_LIST_CHAR_BUDGET = 48_000;

/** Below this many characters per skill a shortened description stops helping. */
const MIN_COMPACT_DESCRIPTION_CHARS = 24;

const isFilesystemSkill = (skill: SkillItem) =>
  skill.source === 'project' || skill.source === 'device';

const shorten = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;

/**
 * Largest per-skill description length whose shortened descriptions fit
 * `room` characters in total: short descriptions stay whole and the long ones
 * share what is left evenly.
 */
const fitDescriptionLength = (lengths: number[], room: number): number => {
  let low = 0;
  let high = Math.max(0, ...lengths);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const used = lengths.reduce((sum, length) => sum + Math.min(length, mid), 0);
    if (used <= room) low = mid;
    else high = mid - 1;
  }
  return low;
};

interface CompactSkillTags {
  /** Skills left out because not even their names fit. */
  omitted: number;
  tags: string;
}

/**
 * The over-budget form of the skill tags. Every skill keeps its name, so the
 * model can still pick any of them and `activateSkill` loads the full content;
 * only the parts activation does not need shrink:
 *
 * 1. `location` is dropped when `activateSkill` was sent: activation finds a
 *    filesystem skill by name and reports its directory. Without the tool the
 *    path is the only way in, so it stays.
 * 2. Descriptions are cut to one shared length, the longest that fits.
 * 3. When even that length would be too short to help, descriptions are
 *    dropped, and the names that still do not fit are left out and counted.
 */
const compactSkillTags = (
  skills: SkillItem[],
  room: number,
  { keepLocation }: { keepLocation: boolean },
): CompactSkillTags => {
  const items = skills.map((skill) => ({
    ...skill,
    description: skill.description.replaceAll(/\s+/g, ' ').trim(),
    location: keepLocation ? skill.location : undefined,
  }));
  // Each tag costs its markup plus a newline separator
  const bare = items.map((skill) => skillPrompt({ ...skill, description: '' }).length + 1);
  const descriptionRoom = room - bare.reduce((sum, length) => sum + length, 0);
  const max = fitDescriptionLength(
    items.map((skill) => skill.description.length),
    descriptionRoom,
  );

  if (descriptionRoom > 0 && max >= MIN_COMPACT_DESCRIPTION_CHARS) {
    const tags = items
      .map((skill) => skillPrompt({ ...skill, description: shorten(skill.description, max) }))
      .join('\n');
    return { omitted: 0, tags };
  }

  const listed: string[] = [];
  let used = 0;
  for (const [index, skill] of items.entries()) {
    if (used + bare[index] > room) break;
    used += bare[index];
    listed.push(skillPrompt({ ...skill, description: '' }));
  }
  return { omitted: items.length - listed.length, tags: listed.join('\n') };
};

const SKILLS_INTRO = `The following skills provide specialized instructions for specific tasks.
Use the activateSkill tool to load a skill when the user's task matches its description.`;

/** Room the compact header and notes may take, kept out of the tags' share. */
const COMPACT_HEADER_RESERVE = 1200;

export const skillsPrompts = (skills: SkillItem[], options: SkillsPromptOptions = {}) => {
  if (skills.length === 0) return '';

  const { canActivateSkill = true } = options;

  const hasFilesystemSkill = skills.some(isFilesystemSkill);
  // Activation records the skill for the run, which is how `execScript` finds
  // its directory, so it is the way in whenever the tool was sent. Reading the
  // file is the only way left when it was not.
  const filesystemHint = !hasFilesystemSkill
    ? ''
    : canActivateSkill
      ? `\nFor a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile) and resolve relative paths against the parent directory of its \`location\` (parent of SKILL.md).`
      : `\nFor a skill with source="project" or source="device", load it by calling the readFile tool on its \`location\` path and resolve relative paths against its parent directory (parent of SKILL.md).`;

  const skillTags = skills.map((skill) => skillPrompt(skill)).join('\n');
  const full = `${SKILLS_INTRO}${filesystemHint}

<available_skills>
${skillTags}
</available_skills>`;
  if (full.length <= SKILLS_LIST_CHAR_BUDGET) return full;

  const { omitted, tags } = compactSkillTags(
    skills,
    SKILLS_LIST_CHAR_BUDGET - COMPACT_HEADER_RESERVE,
    { keepLocation: !canActivateSkill },
  );

  const notes = [
    canActivateSkill
      ? `There are ${skills.length} skills, too many to describe in full, so the descriptions below are shortened; activateSkill loads a skill's full instructions.`
      : `There are ${skills.length} skills, too many to describe in full, so the descriptions below are shortened; a skill's SKILL.md holds its full instructions.`,
  ];
  if (hasFilesystemSkill) {
    notes.push(
      canActivateSkill
        ? 'For a skill with source="project" or source="device", load it with activateSkill by name (do not bypass activation with readFile); its result gives the skill directory to resolve relative paths against.'
        : 'For a skill with source="project" or source="device", load it by calling the readFile tool on its `location` path and resolve relative paths against its parent directory (parent of SKILL.md).',
    );
  }
  if (omitted > 0) {
    notes.push(
      canActivateSkill
        ? `${omitted} more skills are not listed. When none of the listed skills fits, call activateSkill with the name you expect: a miss returns the closest matching skill names.`
        : `${omitted} more skills are not listed.`,
    );
  }

  return `${SKILLS_INTRO}
${notes.join('\n')}

<available_skills>
${tags}
</available_skills>`;
};
