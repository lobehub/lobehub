import {
  CredsIdentifier,
  type CredSummary,
  injectCredsContext,
  type UserCredsContext,
} from '@lobechat/builtin-tool-creds';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { RuntimeSelectedSkill, UserCredSummary } from '@lobechat/types';

import { agentSkillService } from '@/services/skill';
import { getToolStoreState } from '@/store/tool';

interface PreloadedSkill {
  content: string;
  identifier: string;
  name: string;
}

interface PrepareSelectedSkillPreloadParams {
  message: string;
  selectedSkills?: RuntimeSelectedSkill[];
  /**
   * User credentials for creds skill injection
   */
  userCreds?: UserCredSummary[];
}

// Match <skill name="..." label="..." /> and legacy <action type="..." category="skill" ... />
const SKILL_TAG_REGEX = /<skill\b([^>]*)\/>/g;
const LEGACY_ACTION_TAG_REGEX = /<action\b([^>]*)\/>/g;

const getAttr = (attrs: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
};

const extractSelectedSkillsFromText = (text: string): RuntimeSelectedSkill[] => {
  const parsedSkills: RuntimeSelectedSkill[] = [];

  // New format: <skill name="..." label="..." />
  for (const match of text.matchAll(SKILL_TAG_REGEX)) {
    const attrs = match[1] || '';
    const identifier = getAttr(attrs, 'name');
    if (!identifier) continue;
    parsedSkills.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  // Legacy format: <action type="..." category="skill" label="..." />
  for (const match of text.matchAll(LEGACY_ACTION_TAG_REGEX)) {
    const attrs = match[1] || '';
    if (getAttr(attrs, 'category') !== 'skill') continue;
    const identifier = getAttr(attrs, 'type');
    if (!identifier) continue;
    parsedSkills.push({ identifier, name: getAttr(attrs, 'label') || identifier });
  }

  return parsedSkills;
};

const resolveSelectedSkills = (
  message: string,
  selectedSkills?: RuntimeSelectedSkill[],
): RuntimeSelectedSkill[] => {
  const mergedSkills = [...(selectedSkills || []), ...extractSelectedSkillsFromText(message)];
  const seen = new Set<string>();

  return mergedSkills.reduce<RuntimeSelectedSkill[]>((acc, skill) => {
    if (!skill.identifier || seen.has(skill.identifier)) return acc;

    seen.add(skill.identifier);
    acc.push(skill);
    return acc;
  }, []);
};

/**
 * Convert UserCredSummary to CredSummary for injection
 */
const mapToCredSummary = (cred: UserCredSummary): CredSummary => ({
  description: cred.description,
  key: cred.key,
  name: cred.name,
  type: cred.type,
});

/**
 * Build creds context for injection
 */
const buildCredsContext = (userCreds?: UserCredSummary[]): UserCredsContext => ({
  creds: (userCreds || []).map(mapToCredSummary),
  settingsUrl: '/settings/creds',
});

const loadSkillContent = async (
  selectedSkill: RuntimeSelectedSkill,
  userCreds?: UserCredSummary[],
): Promise<PreloadedSkill | undefined> => {
  const toolState = getToolStoreState();

  const builtinSkill = (toolState.builtinSkills || []).find(
    (skill) => skill.identifier === selectedSkill.identifier,
  );

  if (builtinSkill) {
    let content = builtinSkill.content;

    // Inject creds context for the creds skill
    if (builtinSkill.identifier === CredsIdentifier) {
      const credsContext = buildCredsContext(userCreds);
      content = injectCredsContext(content, credsContext);
    }

    return {
      content,
      identifier: builtinSkill.identifier,
      name: builtinSkill.name,
    };
  }

  const listItem = (toolState.agentSkills || []).find(
    (skill) => skill.identifier === selectedSkill.identifier,
  );

  const detail =
    (listItem && toolState.agentSkillDetailMap?.[listItem.id]) ||
    (listItem ? await agentSkillService.getById(listItem.id) : undefined) ||
    (await agentSkillService.getByIdentifier(selectedSkill.identifier));

  if (!detail?.content) return undefined;

  const hasResources = !!(detail.resources && Object.keys(detail.resources).length > 0);
  const content = hasResources
    ? detail.content + '\n\n' + resourcesTreePrompt(detail.name, detail.resources!)
    : detail.content;

  return {
    content,
    identifier: detail.identifier,
    name: detail.name,
  };
};

/**
 * Enrich selected skills with preloaded content from skill store.
 * Skills with available content get it attached directly, enabling
 * SelectedSkillInjector to inline the content into the user message
 * instead of constructing fake activateSkill tool-call preload messages.
 */
export const resolveSelectedSkillsWithContent = async ({
  message,
  selectedSkills,
  userCreds,
}: PrepareSelectedSkillPreloadParams): Promise<RuntimeSelectedSkill[]> => {
  const resolved = resolveSelectedSkills(message, selectedSkills);

  if (resolved.length === 0) return [];

  const enriched = await Promise.all(
    resolved.map(async (skill) => {
      const loaded = await loadSkillContent(skill, userCreds);
      return loaded ? { ...skill, content: loaded.content } : skill;
    }),
  );

  return enriched;
};
