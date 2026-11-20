import { builtinSkills } from '@lobechat/builtin-skills';
import { assembleSkillPool } from '@lobechat/mecha';
import {
  type AgentPluginEntry,
  getActivePluginIds,
  getAutoPluginIds,
  getDisabledPluginIds,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import type { LobeChatDatabase } from '@/database/type';
import { AgentDocumentsService } from '@/server/services/agentDocuments';
import { UserSkillService } from '@/server/services/userSkill';

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
  /**
   * Whether the run may use the creator's device. Off for the share picker;
   * a visitor run's automatic grants pass the visitor's device access, so a
   * device-only skill the Agent turns on is granted to visitors who can run it.
   */
  canExecuteOnDevice?: boolean;
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
 *   filesystem, which this listing never scans;
 * - `canExecuteOnDevice` off by default; a visitor run passes its own device
 *   access instead, so device-only builtin skills follow what it may run.
 *
 * The user's skill library is listed as a run lists it: its catalog without
 * generated skills, and none at all for a workspace-public Agent.
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
  canExecuteOnDevice = false,
  db,
  userId,
  workspaceId,
}: GrantableSkillsInput): Promise<ShareGrantableSkill[]> => {
  const plugins = agentConfig?.plugins ?? undefined;
  const [dbSkills, agentSkills, userSkills] = await Promise.all([
    new AgentSkillModel(db, userId, workspaceId).findAll().then((result) => result.data),
    // A bundle-less agent is the common case and throws nothing; a genuine
    // failure here must not take the whole list down with it — the DB and
    // builtin skills are still grantable.
    new AgentDocumentsService(db, userId, workspaceId).getAgentSkills(agentId).catch(() => []),
    (async () =>
      new UserSkillService(
        db,
        userId,
        workspaceId,
        workspaceId
          ? await new AgentModel(db, userId, workspaceId).getAgentVisibility(agentId)
          : undefined,
      ).listCatalog({ includeGenerated: false }))(),
  ]);

  const { skills } = assembleSkillPool(
    {
      agentSkills: [...agentSkills, ...userSkills].map((skill) => ({
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
      canExecuteOnDevice,
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
