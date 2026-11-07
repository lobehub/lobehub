import type { LobeToolMeta } from '@lobechat/types';

import type { ToolStoreState } from '../../initialState';
import {
  AGENT_SKILL_LIST_KEY,
  type AgentSkillDetailItem,
  type AgentSkillListItem,
} from './projection';

const getAgentSkills = (s: ToolStoreState): AgentSkillListItem[] =>
  s.agentSkillListMap?.[AGENT_SKILL_LIST_KEY] || [];

/**
 * Whether the installed skills list holds the server's answer. The replica also
 * hydrates from IndexedDB, and that copy can predate a skill installed on
 * another device, so a populated list alone is not proof it is current.
 */
const isAgentSkillListSynced = (s: ToolStoreState): boolean =>
  s.agentSkillListReplica?.entries[AGENT_SKILL_LIST_KEY]?.source === 'server';

const getMarketAgentSkills = (s: ToolStoreState): AgentSkillListItem[] =>
  getAgentSkills(s).filter((skill) => skill.source === 'market');

const getUserAgentSkills = (s: ToolStoreState): AgentSkillListItem[] =>
  getAgentSkills(s).filter((skill) => skill.source === 'user');

const getAgentSkillByIdentifier =
  (identifier: string) =>
  (s: ToolStoreState): AgentSkillListItem | undefined =>
    getAgentSkills(s).find((skill) => skill.identifier === identifier);

const getAgentSkillDetail =
  (id: string) =>
  (s: ToolStoreState): AgentSkillDetailItem | undefined =>
    s.agentSkillDetailMap?.[id]?.skillDetail;

const isAgentSkill =
  (identifier: string) =>
  (s: ToolStoreState): boolean =>
    getAgentSkills(s).some((skill) => skill.identifier === identifier);

const agentSkillMetaList = (s: ToolStoreState): LobeToolMeta[] =>
  getAgentSkills(s).map((skill) => {
    const author = skill.manifest?.author;
    const authorName = typeof author === 'string' ? author : author?.name || 'User';

    return {
      author: authorName,
      identifier: skill.identifier,
      meta: {
        avatar: '🧩',
        description: skill.description ?? skill.manifest?.description ?? '',
        title: skill.name,
      },
      type: 'builtin' as const,
    };
  });

export const agentSkillsSelectors = {
  agentSkillMetaList,
  getAgentSkillByIdentifier,
  getAgentSkillDetail,
  getAgentSkills,
  getMarketAgentSkills,
  getUserAgentSkills,
  isAgentSkill,
  isAgentSkillListSynced,
};
