import { SkillsApiName, SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { resourcesTreePrompt } from '@lobechat/prompts';
import type { RuntimeSelectedSkill, SendPreloadMessage } from '@lobechat/types';
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

const loadSkillContent = async (
  selectedSkill: RuntimeSelectedSkill,
): Promise<PreloadedSkill | undefined> => {
  const toolState = getToolStoreState();

  const builtinSkill = (toolState.builtinSkills || []).find(
    (skill) => skill.identifier === selectedSkill.identifier,
  );

  if (builtinSkill) {
    return {
      content: builtinSkill.content,
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
            apiName: SkillsApiName.activateSkill,
            arguments: args,
            id: toolCallId,
            identifier: SkillsIdentifier,
            type: 'builtin',
          },
        ],
      },
      {
        content: skill.content,
        plugin: {
          apiName: SkillsApiName.activateSkill,
          arguments: args,
          identifier: SkillsIdentifier,
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
}: PrepareSelectedSkillPreloadParams): Promise<SendPreloadMessage[]> => {
  const resolvedSelectedSkills = resolveSelectedSkills(message, selectedSkills);

  if (resolvedSelectedSkills.length === 0) {
    return [];
  }

  const resolvedSkills = (
    await Promise.all(
      resolvedSelectedSkills.map((selectedSkill) => loadSkillContent(selectedSkill)),
    )
  ).filter((skill): skill is PreloadedSkill => !!skill);

  return buildPersistedPreloadMessages(resolvedSkills);
};
