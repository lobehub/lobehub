import { builtinSkills, LobeHubIdentifier } from '@lobechat/builtin-skills';
import type { OperationSkillSet } from '@lobechat/context-engine';
import { mentionsTopic } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import { assembleSkillPool } from '@lobechat/mecha';
import { resourcesTreePrompt } from '@lobechat/prompts';
import { getActivePluginIds } from '@lobechat/types';
import debug from 'debug';

import type { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { TaskModel } from '@/database/models/task';
import { isDeviceCapablePlan } from '@/helpers/executionTarget';
import type { AgentDocumentsService } from '@/server/services/agentDocuments';
import { readTaskSkillIds, UserSkillService } from '@/server/services/userSkill';

import { filterSkillsByShareGate } from '../shareGate';
import type { ExecRunContext, ResolvedWorkspaceInit } from '../types';
import type { ToolDiscoveryResult } from './toolDiscovery';

const log = debug('lobe-server:ai-agent-service');

export interface OperationSkillSetDeps {
  agentDocumentsService: AgentDocumentsService;
  agentModel: AgentModel;
  db: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

export interface OperationSkillSetInput {
  activeDeviceId: ToolDiscoveryResult['activeDeviceId'];
  agentConfig: ExecRunContext['agentConfig'];
  agentPlugins: ToolDiscoveryResult['agentPlugins'];
  /** Tri-state disabled plugin identifiers — excluded from the skill pool. */
  disabledPluginIds: string[];
  executionPlan: ToolDiscoveryResult['executionPlan'];
  prompt: ExecRunContext['prompt'];
  resolvedAgentId: ExecRunContext['resolvedAgentId'];
  /**
   * Skills the user selected in this topic, from this turn's request and the
   * `metadata.selectedSkillIds` of earlier user turns (see
   * {@link collectSelectedSkillIds}). Injected with their bodies like pinned skills.
   */
  selectedSkillIds: string[];
  shareGate: ExecRunContext['shareGate'];
  /** The Task this run executes; the skills it names are trusted for this run. */
  taskId?: string;
  workspaceInit: ResolvedWorkspaceInit;
}

/**
 * The skills the user selected anywhere in this topic so far: the current
 * request's selection plus every earlier user turn's persisted
 * `metadata.selectedSkillIds`. Deduplicated, in first-selected order.
 *
 * Reading the history keeps a selected skill injected on later turns, which
 * the client runtime achieves by persisting the skill body into the message.
 */
export const collectSelectedSkillIds = (
  historyMessages: ReadonlyArray<{
    metadata?: { selectedSkillIds?: unknown } | null;
    role: string;
  }>,
  current: readonly string[] = [],
): string[] => {
  const ids: string[] = [];
  for (const message of historyMessages) {
    if (message.role !== 'user') continue;
    const persisted = message.metadata?.selectedSkillIds;
    if (!Array.isArray(persisted)) continue;
    for (const id of persisted) if (typeof id === 'string') ids.push(id);
  }
  return [...new Set([...ids, ...current])];
};

/**
 * Stage 18 of {@link AiAgentService.execAgent}: build the OperationSkillSet via SkillEngine.
 *
 * Combines builtin skills + user DB skills + agent-document skill bundles,
 * filters by platform via enableChecker, and pairs with agent's enabled
 * plugin IDs for downstream SkillResolver consumption.
 *
 * Returns `undefined` when any source fails to load; the run then proceeds
 * without a skill set, as it did before this stage was extracted.
 */
export const buildOperationSkillSet = async (
  deps: OperationSkillSetDeps,
  input: OperationSkillSetInput,
): Promise<OperationSkillSet | undefined> => {
  const {
    activeDeviceId,
    agentConfig,
    agentPlugins,
    disabledPluginIds,
    executionPlan,
    prompt,
    resolvedAgentId,
    selectedSkillIds,
    shareGate,
    taskId,
    workspaceInit,
  } = input;

  try {
    const builtinMetas = builtinSkills.map((s) => ({
      content: s.content,
      description: s.description,
      identifier: s.identifier,
      name: s.name,
    }));
    const skillModel = new AgentSkillModel(deps.db, deps.userId, deps.workspaceId);
    const { data: dbSkills } = await skillModel.findAll();

    // Pinned skills need their SKILL.md body injected into context directly,
    // not lazily via the `activateSkill` tool. Gate on the agent's genuinely
    // pinned entries (`getActivePluginIds(agentConfig.plugins)`), NOT the
    // fully-expanded `agentPlugins`: the latter also carries turn-scoped tool
    // ids (mentions, selected tools, `lobe-message`, …), which would
    // eager-activate an auto-mode skill whose identifier merely collides with
    // one of them. `findAll` uses `skillListColumns` (no `content`), so fetch
    // bodies only for the pinned subset to keep the op-param payload bounded.
    // Non-pinned skills stay content-less here and remain lazily activatable.
    // Content lives in the DB `content` column already (SKILL.md body), so no
    // zip unpack is needed; mirror `activateSkill` by appending the resource
    // tree so pinned ZIP/GitHub skills keep their `readReference` paths.
    //
    // Skills the user explicitly selected in this topic are injected the same
    // way: the selection names them directly, so no tool id can collide into it.
    const pinnedSkillIds = new Set(getActivePluginIds(agentConfig.plugins));
    const injectedSkillIds = new Set([...pinnedSkillIds, ...selectedSkillIds]);
    const pinnedDbSkillIds = dbSkills
      .filter((s) => injectedSkillIds.has(s.identifier))
      .map((s) => s.id);
    const pinnedDbContent = new Map(
      (await skillModel.findByIds(pinnedDbSkillIds)).map((s) => {
        const hasResources = !!(s.resources && Object.keys(s.resources).length > 0);
        const content =
          hasResources && s.resources
            ? `${s.content ?? ''}\n\n${resourcesTreePrompt(s.name, s.resources)}`
            : (s.content ?? undefined);
        return [s.identifier, content] as const;
      }),
    );
    const dbMetas = dbSkills.map((s) => ({
      content: pinnedDbContent.get(s.identifier),
      description: s.description ?? '',
      identifier: s.identifier,
      name: s.name,
    }));

    // Agent-document skill bundles surfaced as runtime skills via the shared
    // `getAgentSkills` source of truth (prefix + index-child resolution lives
    // there; see `AgentDocumentsService.getAgentSkills`). Identifier is
    // prefixed (`agent-skills:<filename>`) so it can't collide with builtin
    // / DB skill names, and we re-use it as `name` so the prompt's
    // `<skill name="...">` line and the model's `activateSkill(name)` call
    // carry the same value.
    const agentSkills = await deps.agentDocumentsService.getAgentSkills(resolvedAgentId);
    const agentSkillMetas = agentSkills.map((skill) => ({
      // `getAgentSkills` already resolves the bundle body, so pinned
      // agent-document skills inject directly without an extra fetch; only
      // attach it for the pinned subset to keep the payload lean.
      content: injectedSkillIds.has(skill.identifier) ? skill.content : undefined,
      description: skill.description,
      identifier: skill.identifier,
      name: skill.name,
    }));

    // The user's own skill library: listed to every run, and injected up front
    // when the agent pins one or the run names it in its plugins — a goal
    // batch's unit runs name the batch's plan skill that way.
    // The catalog carries no bodies; only the pinned / run-named skills read
    // theirs, so a library that grows with every batch stays cheap to list.
    // A workspace-public agent never reads its caller's private skills — every
    // user skill is private — so its runs see none of them.
    const userSkills = new UserSkillService(
      deps.db,
      deps.userId,
      deps.workspaceId,
      deps.workspaceId ? await deps.agentModel.getAgentVisibility(resolvedAgentId) : undefined,
    );
    // The skills the run's own Task names (a goal batch's plan) load even
    // through a public agent — and only those; nothing the model or a picker
    // supplies widens that.
    const taskSkillIds = taskId
      ? readTaskSkillIds(
          (await new TaskModel(deps.db, deps.userId, deps.workspaceId).findById(taskId))?.config,
        )
      : [];
    const namedUserSkills = await userSkills.loadRuntimeSkills(
      [...injectedSkillIds, ...(agentPlugins ?? []), ...taskSkillIds],
      { trustedGenerated: taskSkillIds },
    );
    // Skills the system generated for one job (a goal batch's plan) are not
    // listed to every run — one accumulates per batch, so the query leaves them
    // out — only joined where the run pins or names them, as that batch's units
    // do. Those come in with their bodies.
    const listed = await userSkills.listCatalog({ includeGenerated: false });
    const listedIds = new Set(listed.map((skill) => skill.identifier));
    const namedContent = new Map(
      namedUserSkills.map((skill) => [skill.identifier, skill.content] as const),
    );
    const userSkillMetas = [
      ...listed.map((skill) => ({
        content: namedContent.get(skill.identifier),
        description: skill.description,
        identifier: skill.identifier,
        name: skill.name,
      })),
      ...namedUserSkills
        .filter((skill) => !listedIds.has(skill.identifier))
        .map((skill) => ({
          content: skill.content,
          description: skill.description,
          identifier: skill.identifier,
          name: skill.name,
        })),
    ];

    const projectMetas = workspaceInit.workspace.skills.map((s) => ({
      description: s.description ?? '',
      identifier: `${s.scope === 'device' ? 'device' : 'project'}:${s.name}`,
      location: s.path,
      name: s.name,
      source: s.scope === 'device' ? ('device' as const) : ('project' as const),
    }));

    if (projectMetas.length) {
      log(
        'execAgent: workspace skills merged: %d (activeDeviceId=%s)',
        projectMetas.length,
        activeDeviceId ?? 'none',
      );
    }

    // Precedence, name dedupe, the disabled drop, the share allowlist and the
    // device-only builtin gate are the shared rules in `@lobechat/mecha`; this
    // pipeline supplies the four sources and the run's facts.
    //
    // A shared run only sees skills its share configuration allows —
    // `shareConfig.skillGrants`, the creator's explicit per-skill list, NOT the
    // tool picker (`filterSkillsByShareGate`). The pool is the FIRST
    // enforcement point, not the only one: `activateSkill` takes a
    // model-supplied name, so the skill runtime re-checks the same grant at
    // load time.
    const shareAllowedSkillIds = shareGate
      ? filterSkillsByShareGate(
          [...projectMetas, ...dbMetas, ...agentSkillMetas, ...userSkillMetas, ...builtinMetas].map(
            (skill) => skill.identifier,
          ),
          shareGate,
        )
      : undefined;

    // Whether a skill is PINNED is the agent's own configuration; the share
    // only decides whether the visitor may reach it. `agentPlugins` has already
    // been narrowed by the TOOL grants (`filterPluginsByShareGate` in
    // `toolDiscovery`), which drops a skill the creator granted as a skill
    // rather than as a tool — leaving it un-pinned for the visitor (no content
    // injection) and, under `manual` mode, dropped from the pool entirely. Add
    // back exactly the ids that are both genuinely pinned on the agent AND
    // allowed by this share's skill grants; nothing else widens.
    const shareEnabledSkillIds = shareAllowedSkillIds?.filter((id) => pinnedSkillIds.has(id)) ?? [];

    // Device-only builtin skills are gated on the run's execution plan, not
    // the compile-time `isDesktop` constant (always false on the server). Use
    // the device-CAPABLE plan rather than `activeDeviceId`: a
    // `device-unrouted` run lets the model pick a device mid-run, and this
    // skill set is built once per operation, so gating on the routed device
    // would hide the skill forever in those runs. Activation and loading
    // apply the same plan gate via `ToolExecutionContext.deviceCapable`; only
    // command execution is gated at the device tool layer.
    return assembleSkillPool(
      {
        agentSkills: [...agentSkillMetas, ...userSkillMetas],
        builtin: builtinMetas,
        db: dbMetas,
        project: projectMetas,
      },
      {
        canExecuteOnDevice: executionPlan ? isDeviceCapablePlan(executionPlan) : false,
        disabledIds: disabledPluginIds,
        // Selected skills join the enabled set so the resolver auto-activates
        // them; a share allowlist or a disabled entry still drops them above.
        enabledPluginIds: [
          ...new Set([...(agentPlugins ?? []), ...shareEnabledSkillIds, ...selectedSkillIds]),
        ],
        shareAllowedIds: shareAllowedSkillIds,
        skillActivateMode: agentConfig.chatConfig?.skillActivateMode,
        // Reading another topic (`<refer_topic>` or a raw `tpc_` id) goes through `lh topic view`,
        // which the lobehub skill teaches.
        turnSkillIds: mentionsTopic([{ content: prompt ?? '' }]) ? [LobeHubIdentifier] : [],
      },
    );
  } catch (error) {
    log('execAgent: failed to build operationSkillSet: %O', error);
    return undefined;
  }
};
