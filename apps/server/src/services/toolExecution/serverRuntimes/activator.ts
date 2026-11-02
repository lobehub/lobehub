import { builtinSkills } from '@lobechat/builtin-skills';
import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { validateAtomicCapabilityBundle } from '@lobechat/context-engine/onDemand';
import { getDisabledPluginIds } from '@lobechat/types';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { ConnectorToolPermission } from '@/database/schemas';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import { getConnectorToolPermission } from '@/libs/mcp/connectorPermissionCheck';
import {
  emitToolOutcomeSafely,
  resolveToolOutcomeScope,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';
import { resolveSubAgentModelGuidance } from '@/server/utils/subAgentModelGuidance';

import { type ServerRuntimeRegistration } from './types';

/**
 * Tools Activator Server Runtime
 * Resolves tool manifests from context.toolManifestMap (populated by the agent state).
 */
export const activatorRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    const activatedIds: string[] = [];
    const isOnDemand = context.contextMode === 'on-demand';
    const emitActivationOutcome = async (input: {
      errorReason?: string;
      identifiers: string[];
      status: 'failed' | 'succeeded';
      summary: string;
    }) => {
      if (!context.userId) return;

      const { scope, scopeKey } = resolveToolOutcomeScope({
        agentId: context.agentId,
        taskId: context.taskId,
        topicId: context.topicId,
        userId: context.userId,
      });

      await emitToolOutcomeSafely({
        apiName: 'activateSkill',
        context: { agentId: context.agentId, userId: context.userId },
        domainKey: 'skill:builtin-skill',
        errorReason: input.errorReason,
        identifier: LobeActivatorIdentifier,
        intentClass: 'tool_command',
        messageId: context.messageId,
        operationId: context.operationId,
        policyStateStore: redisPolicyStateStore,
        relatedObjects: input.identifiers.map((id) => ({
          objectId: id,
          objectType: 'skill',
          relation: 'selected',
        })),
        scope,
        scopeKey,
        status: input.status,
        summary: input.summary,
        ttlSeconds: 7 * 24 * 60 * 60,
        toolAction: 'activate',
        toolCallId: context.toolCallId,
      });
    };

    // Create SkillsExecutionRuntime for activateSkill delegation
    let skillsRuntime: SkillsExecutionRuntime | undefined;
    if (context.serverDB && context.userId) {
      const skillModel = new AgentSkillModel(context.serverDB, context.userId, context.workspaceId);

      // `activateSkill` resolves independently of `operationSkillSet`/
      // `<available_skills>` (built once, earlier, in aiAgent/index.ts) — it
      // queries builtins/DB directly by name. Without this guard, a skill
      // the agent has explicitly disabled would no longer be *listed*, but a
      // model that already knows its name (prior turn, or a guess) could
      // still activate and use it. Re-derive the disabled set here so this
      // independent resolution path enforces the same tri-state.
      let disabledSkillIds = new Set<string>();
      if (context.agentId) {
        const agentModel = new AgentModel(context.serverDB, context.userId, context.workspaceId);
        const agentConfig = await agentModel.getAgentConfigById(context.agentId);
        disabledSkillIds = new Set(getDisabledPluginIds(agentConfig?.plugins ?? undefined));
      }

      skillsRuntime = new SkillsExecutionRuntime({
        // Same device gate as the skills runtime: device-only skills are
        // activatable in device-capable runs (matching <available_skills>),
        // with `activeDeviceId` as the fallback for callers without a plan.
        builtinSkills: filterBuiltinSkills(builtinSkills, {
          canExecuteOnDevice: context.deviceCapable ?? !!context.activeDeviceId,
        }).filter((skill) => !disabledSkillIds.has(skill.identifier)),
        service: {
          findAll: () => skillModel.findAll(),
          findById: async (id) => {
            const skill = await skillModel.findById(id);
            return skill && disabledSkillIds.has(skill.identifier) ? undefined : skill;
          },
          findByName: async (name) => {
            const skill = await skillModel.findByName(name);
            return skill && disabledSkillIds.has(skill.identifier) ? undefined : skill;
          },
          readResource: async () => {
            throw new Error('readResource not available in tools runtime');
          },
        },
      });
    }

    const service: ActivatorRuntimeService = {
      activateSkill: skillsRuntime
        ? async (args) => {
            try {
              const result = await skillsRuntime!.activateSkill(args);
              await emitActivationOutcome({
                identifiers: [args.name],
                status: 'succeeded',
                summary: 'Activator selected a skill.',
              });
              return result;
            } catch (error) {
              await emitActivationOutcome({
                errorReason: (error as Error).message,
                identifiers: [args.name],
                status: 'failed',
                summary: 'Activator failed to select a skill.',
              });
              throw error;
            }
          }
        : undefined,
      getActivatedToolIds: () => [...activatedIds],
      getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
        if (isOnDemand) {
          const pool = context.discoveryPool;
          if (!pool) return [];

          const results: ToolManifestInfo[] = [];
          for (const id of identifiers) {
            const card = pool.cards.find((item) => item.identifier === id);
            const bundle = pool.bundles[id];
            if (!card || !bundle || card.hash !== bundle.hash || card.version !== bundle.version) {
              continue;
            }

            const validation = validateAtomicCapabilityBundle(bundle, {
              hash: card.hash,
              identifier: card.identifier,
              version: card.version,
            });
            if (!validation.ok) continue;

            if (context.serverDB && context.userId) {
              const permissions = await Promise.all(
                validation.bundle.manifest.api.map((api) =>
                  getConnectorToolPermission(
                    context.serverDB!,
                    context.userId!,
                    id,
                    api.name,
                    context.workspaceId,
                    context.agentId,
                  ),
                ),
              );
              if (permissions.includes(ConnectorToolPermission.disabled)) {
                continue;
              }
            }

            const manifest = validation.bundle.manifest;
            results.push({
              apiDescriptions: manifest.api.map((api) => ({
                description: api.description,
                name: api.name,
              })),
              avatar: manifest.meta?.avatar,
              capability: {
                hash: card.hash,
                identifier: card.identifier,
                version: card.version,
              },
              capabilitySummary: card.capability,
              executionEnvironment: card.executionEnvironment,
              identifier: manifest.identifier,
              manual: validation.bundle.manual.content,
              name: card.name,
              source: card.source,
              systemRole: manifest.systemRole,
              version: card.version,
            });
          }

          return results;
        }

        // Note: context.toolManifestMap should only contain discoverable tools.
        // The caller is responsible for scoping this map to exclude hidden/internal tools.
        const results: ToolManifestInfo[] = [];

        for (const id of identifiers) {
          const manifest = context.toolManifestMap[id];
          if (!manifest) continue;

          results.push({
            apiDescriptions: manifest.api.map((a) => ({
              description: a.description,
              name: a.name,
            })),
            identifier: manifest.identifier,
            name: manifest.meta?.title ?? manifest.identifier,
            systemRole: manifest.systemRole,
          });
        }

        return results;
      },
      isOnDemand: () => isOnDemand,
      markActivated: (identifiers: string[]) => {
        for (const id of identifiers) {
          if (!activatedIds.includes(id)) {
            activatedIds.push(id);
          }
        }
        void emitActivationOutcome({
          identifiers,
          status: 'succeeded',
          summary: 'Activator marked skills as active.',
        }).catch((error) => {
          console.error('[AgentSignal] Failed to emit activator outcome:', error);
        });
      },
    };

    const runtime = new ActivatorExecutionRuntime({ service });

    // When lobe-agent is newly activated, resolve the user's enabled chat
    // models ONCE and append them to the activation result. The list changes
    // very infrequently, so it is injected at activation time (a rare event)
    // and then stays fixed — no per-run DB queries or prompt rebuilding.
    // Only models of providers the user actually enabled are listed (the
    // shared resolver filters by `ai_providers.enabled`); fail-open on error.
    const baseActivateTools = runtime.activateTools.bind(runtime);
    runtime.activateTools = async (args) => {
      const result = await baseActivateTools(args);
      if (!result.success) return result;

      const activatedTools = (
        result.state as { activatedTools?: Array<{ identifier: string }> } | undefined
      )?.activatedTools;
      if (!activatedTools?.some((t) => t.identifier === LobeAgentIdentifier)) {
        return result;
      }

      const guidance =
        context.serverDB && context.userId
          ? await resolveSubAgentModelGuidance(
              context.serverDB,
              context.userId,
              context.workspaceId,
            )
          : undefined;
      if (!guidance) return result;

      return { ...result, content: `${result.content}\n\n${guidance}` };
    };

    return runtime;
  },
  identifier: LobeActivatorIdentifier,
};
