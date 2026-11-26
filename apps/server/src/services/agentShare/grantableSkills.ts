import { builtinSkills } from '@lobechat/builtin-skills';
import {
  resolveUninstalledBuiltinTools,
  type UninstalledBuiltinToolsScope,
} from '@lobechat/builtin-tools';
import { assembleSkillPool } from '@lobechat/mecha';
import {
  getImplicitBuiltinSkillIds,
  getLegacyDisabledBuiltinSkillIds,
  legacyBuiltinSkillIds,
  type SkillDiscoveryChatConfig,
} from '@lobechat/mecha/builtinSkillGate';
import {
  type AgentPluginEntry,
  getActivePluginIds,
  getAutoPluginIds,
  getBuiltinOverrides,
  getDisabledPluginIds,
} from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { UserModel } from '@/database/models/user';
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
        chatConfig?: SkillDiscoveryChatConfig | null;
        createdAt?: Date | string;
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
  /**
   * Apply the owner-run legacy builtin rules: implicit builtin skills for a
   * pre-opt-in Agent, minus legacy library uninstalls. On for the share picker
   * only. A visitor run assembles neither, so its automatic grants must not
   * open a skill the Agent never explicitly turned on.
   */
  includeLegacyBuiltinSkills?: boolean;
  userId: string;
  workspaceId?: string;
}

const resolveLegacyBuiltinSkills = async ({
  agentConfig,
  db,
  userId,
  workspaceId,
}: Pick<GrantableSkillsInput, 'agentConfig' | 'db' | 'userId' | 'workspaceId'>) => {
  const userSettings = await new UserModel(db, userId).getUserSettings().catch(() => null);
  // A failed read cannot confirm any legacy builtin is installed. A missing row
  // (`undefined`) is an owner who never saved settings and keeps the defaults.
  const uninstalledBuiltinIds =
    userSettings === null
      ? legacyBuiltinSkillIds
      : resolveUninstalledBuiltinTools(
          userSettings?.tool as UninstalledBuiltinToolsScope | undefined,
          workspaceId,
        );

  return {
    disabledIds: getLegacyDisabledBuiltinSkillIds(
      uninstalledBuiltinIds,
      getBuiltinOverrides(agentConfig?.plugins),
    ),
    implicitIds: getImplicitBuiltinSkillIds(agentConfig?.createdAt, agentConfig?.chatConfig),
  };
};

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
 * Skills are opt-in per Agent (`auto` or legacy `pinned`). With
 * `includeLegacyBuiltinSkills`, legacy Agents also keep their implicit builtin
 * skills (minus legacy library uninstalls), as their owner's run assembles them.
 *
 * Reads the creator's whole skill catalog: callers must have authorized the
 * Agent's share first.
 */
export const listShareGrantableSkills = async ({
  agentConfig,
  agentId,
  canExecuteOnDevice = false,
  db,
  includeLegacyBuiltinSkills = false,
  userId,
  workspaceId,
}: GrantableSkillsInput): Promise<ShareGrantableSkill[]> => {
  const plugins = agentConfig?.plugins ?? undefined;
  const [dbSkills, agentSkills, userSkills, legacyBuiltinSkills] = await Promise.all([
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
    includeLegacyBuiltinSkills
      ? resolveLegacyBuiltinSkills({ agentConfig, db, userId, workspaceId })
      : undefined,
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
      disabledIds: [...getDisabledPluginIds(plugins), ...(legacyBuiltinSkills?.disabledIds ?? [])],
      enabledPluginIds: getActivePluginIds(plugins),
      implicitBuiltinSkillIds: legacyBuiltinSkills?.implicitIds,
      skillActivateMode: agentConfig?.chatConfig?.skillActivateMode,
    },
  );

  return skills.map((skill) => ({
    description: skill.description,
    identifier: skill.identifier,
    name: skill.name,
  }));
};
