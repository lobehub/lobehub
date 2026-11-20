import { builtinSkills } from '@lobechat/builtin-skills';
import { assembleSkillPool } from '@lobechat/mecha';
import {
  type AgentPluginEntry,
  getActivePluginIds,
  getAutoPluginIds,
  getDisabledPluginIds,
} from '@lobechat/types';

import { AgentSkillModel } from '@/database/models/agentSkill';
import type { LobeChatDatabase } from '@/database/type';
import { AgentDocumentsService } from '@/server/services/agentDocuments';

export interface ShareGrantableSkill {
  description: string;
  identifier: string;
  name: string;
}

interface GrantableSkillsInput {
  agentConfig:
    | {
        chatConfig?: { skillActivateMode?: 'auto' | 'manual' } | null;
        plugins?: AgentPluginEntry[] | null;
      }
    | null
    | undefined;
  agentId: string;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/**
 * Skills this Agent could offer a visitor: the share settings skill picker's
 * list, and the skills `autoGrantAgentTools` opens.
 *
 * Built through the SAME `assembleSkillPool` a real run uses, on the same
 * server-side sources, so the picker cannot offer a skill the run would never
 * assemble (nor hide one it would). Three deliberate differences from a run:
 *
 * - no `shareAllowedIds` — the whole point is to list what COULD be granted;
 * - no project/device skills — those are discovered on the execution device's
 *   filesystem, and a visitor run never routes a device;
 * - `canExecuteOnDevice: false`, for the same reason.
 *
 * Skills are NOT filtered to the agent's pinned set: a skill is on-demand by
 * default, so an unpinned skill is exactly the normal case. `manual` mode is
 * the one exception, and `assembleSkillPool` applies it from
 * `enabledPluginIds` on its own.
 *
 * Reads the creator's whole skill catalog: callers must have authorized the
 * Agent's share first.
 */
export const listShareGrantableSkills = async ({
  agentConfig,
  agentId,
  db,
  userId,
  workspaceId,
}: GrantableSkillsInput): Promise<ShareGrantableSkill[]> => {
  const plugins = agentConfig?.plugins ?? undefined;
  const [dbSkills, agentSkills] = await Promise.all([
    new AgentSkillModel(db, userId, workspaceId).findAll().then((result) => result.data),
    // A bundle-less agent is the common case and throws nothing; a genuine
    // failure here must not take the whole list down with it — the DB and
    // builtin skills are still grantable.
    new AgentDocumentsService(db, userId, workspaceId).getAgentSkills(agentId).catch(() => []),
  ]);

  const { skills } = assembleSkillPool(
    {
      agentSkills: agentSkills.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
      })),
      builtin: builtinSkills.map((skill) => ({
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
      })),
      db: dbSkills.map((skill) => ({
        description: skill.description ?? '',
        identifier: skill.identifier,
        name: skill.name,
      })),
    },
    {
      autoSkillIds: getAutoPluginIds(plugins),
      canExecuteOnDevice: false,
      disabledIds: getDisabledPluginIds(plugins),
      enabledPluginIds: getActivePluginIds(plugins),
      skillActivateMode: agentConfig?.chatConfig?.skillActivateMode,
    },
  );

  return skills.map((skill) => ({
    description: skill.description,
    identifier: skill.identifier,
    name: skill.name,
  }));
};
