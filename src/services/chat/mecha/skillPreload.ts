import { ActivatorApiName, LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  CredsIdentifier,
  type CredSummary,
  injectCredsContext,
  type UserCredsContext,
} from '@lobechat/builtin-tool-creds';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { RuntimeSelectedSkill, SendPreloadMessage, UserCredSummary } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';

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

const ACTION_TAG_REGEX = /<action\b([^>]*)\/>/g;

const getActionAttr = (attrs: string, name: string): string | undefined => {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
  return match?.[1];
};

const cleanupWhitespace = (text: string) =>
  text
    .replaceAll(/[ \t]{2,}/g, ' ')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim();

const extractSelectedSkillsFromText = (text: string): RuntimeSelectedSkill[] => {
  const parsedSkills: RuntimeSelectedSkill[] = [];

  for (const match of text.matchAll(ACTION_TAG_REGEX)) {
    const attrs = match[1] || '';
    if (getActionAttr(attrs, 'category') !== 'skill') continue;

    const identifier = getActionAttr(attrs, 'type');

    if (!identifier) continue;

    parsedSkills.push({
      identifier,
      name: getActionAttr(attrs, 'label') || identifier,
    });
  }

  return parsedSkills;
};

export const stripActionTagsFromText = (text: string) =>
  cleanupWhitespace(text.replaceAll(ACTION_TAG_REGEX, ''));

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

const buildPersistedPreloadMessages = (skills: PreloadedSkill[]): SendPreloadMessage[] =>
  skills.flatMap((skill, index) => {
    const toolCallId = `selected_skill_${index}_${nanoid()}`;
    const args = JSON.stringify({ name: skill.name });

    return [
      {
        content: '',
        role: 'assistant',
        tools: [
          {
            apiName: ActivatorApiName.activateSkill,
            arguments: args,
            id: toolCallId,
            identifier: LobeActivatorIdentifier,
            type: 'builtin',
          },
        ],
      },
      {
        content: skill.content,
        plugin: {
          apiName: ActivatorApiName.activateSkill,
          arguments: args,
          identifier: LobeActivatorIdentifier,
          type: 'builtin',
        },
        role: 'tool',
        tool_call_id: toolCallId,
      },
    ];
  });

export const prepareSelectedSkillPreload = async ({
  message,
  selectedSkills,
  userCreds,
}: PrepareSelectedSkillPreloadParams): Promise<SendPreloadMessage[]> => {
  const resolvedSelectedSkills = resolveSelectedSkills(message, selectedSkills);

  if (resolvedSelectedSkills.length === 0) {
    return [];
  }

  const resolvedSkills = (
    await Promise.all(
      resolvedSelectedSkills.map((selectedSkill) => loadSkillContent(selectedSkill, userCreds)),
    )
  ).filter((skill): skill is PreloadedSkill => !!skill);

  return buildPersistedPreloadMessages(resolvedSkills);
};
