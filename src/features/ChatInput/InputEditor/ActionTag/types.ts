/**
 * Action tag architecture:
 *
 * 1. Command      — Built-in, line-start only (slash menu), executed client-side before send
 * 2. Skill        — Skill package, inserted via @ mention, preloaded before execution
 * 3. Tool         — Explicit tool selection, inserted via @ mention, context injected directly
 * 4. ProjectSkill — Hetero-agent project skill (e.g. `.agents/skills/<name>/SKILL.md`),
 *                   inserted via slash menu, serialized as literal `/skill-name` so the
 *                   underlying CLI agent resolves and runs the skill itself.
 */
export type ActionTagCategory = 'command' | 'skill' | 'tool' | 'projectSkill';

// Built-in commands: client-side intercepted, never sent to AI
export type CommandType = 'compact' | 'newTopic';

// Skills use dynamic identifiers from agent config (plugin/tool identifiers)
export type SkillType = string & {};

export type ActionTagType = CommandType | SkillType;

export interface ActionTagData {
  category: ActionTagCategory;
  icon?: string;
  label: string;
  type: ActionTagType;
}

// Built-in commands — line-start only, client-side execution
export const BUILTIN_COMMANDS: ActionTagData[] = [
  { category: 'command', label: 'newTopic', type: 'newTopic' },
  { category: 'command', label: 'compact', type: 'compact' },
];
