import { builtinSkills } from '@lobechat/builtin-skills';
import { LobeHubIdentifier } from '@lobechat/builtin-skills/manifests';
import type { SkillRuntimeService } from '@lobechat/builtin-tool-skills/executionRuntime';
import { mentionsTopic } from '@lobechat/context-engine';
import {
  type BuiltinToolContext,
  getDisabledPluginIds,
  getLibrarySkillMode,
} from '@lobechat/types';

import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { agentSkillService } from '@/services/skill';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getChatStoreState } from '@/store/chat';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

/** Bind both name lookup and the fallback catalog to the calling agent, not the active tab. */
export const clientSkillCatalog = (ctx: BuiltinToolContext) => {
  const { agentId } = ctx;
  const plugins = agentId
    ? agentSelectors.getAgentConfigById(agentId)(getAgentStoreState())?.plugins
    : undefined;
  const messages = agentId
    ? (getChatStoreState().dbMessagesMap[
        messageMapKey({
          agentId,
          documentId: ctx.documentId ?? undefined,
          groupId: ctx.groupId,
          threadId: ctx.threadId ?? undefined,
          topicId: ctx.topicId,
        })
      ] ?? [])
    : [];
  const userTurns = messages.filter((message) => message.role === 'user');
  const selected = new Set(
    userTurns.flatMap((message) => message.metadata?.selectedSkillIds ?? []),
  );
  if (mentionsTopic(userTurns)) selected.add(LobeHubIdentifier);
  const disabled = new Set(getDisabledPluginIds(plugins));
  const offered = (id: string) =>
    !disabled.has(id) && (selected.has(id) || getLibrarySkillMode(plugins, id) !== 'disabled');
  const lookup: Pick<SkillRuntimeService, 'findAll' | 'findById' | 'findByName'> = {
    findAll: async () => {
      const { data } = await agentSkillService.list();
      const skills = data.filter((skill) => offered(skill.identifier));
      return { data: skills, total: skills.length };
    },
    findById: async (id) => {
      const skill = await agentSkillService.getById(id);
      return skill && offered(skill.identifier) ? skill : undefined;
    },
    findByName: async (name) => {
      const skill = await agentSkillService.getByName(name);
      return skill && offered(skill.identifier) ? skill : undefined;
    },
  };

  return {
    builtinSkills: filterBuiltinSkills(builtinSkills).filter((skill) => offered(skill.identifier)),
    lookup,
  };
};
