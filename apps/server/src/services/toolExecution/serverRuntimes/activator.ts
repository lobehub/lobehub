import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { type SkillsExecutionRuntime } from '@lobechat/builtin-tool-skills/executionRuntime';
import { describeLockedDevicePicker } from '@lobechat/types';

import {
  emitToolOutcomeSafely,
  resolveToolOutcomeScope,
} from '@/server/services/agentSignal/procedure';
import { redisPolicyStateStore } from '@/server/services/agentSignal/store/adapters/redis/policyStateStore';

import { REMOTE_DEVICE_TOOL_IDENTIFIER } from './noActiveDevice';
import { createSkillActivationRuntime } from './skillActivation';
import { type ServerRuntimeRegistration } from './types';

/**
 * Tools Activator Server Runtime
 * Resolves tool manifests from context.toolManifestMap (populated by the agent state).
 */
export const activatorRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    // This factory runs for every tool call, so a list kept here only ever
    // sees the current call. What the run already offers the model — the
    // operation tool set plus earlier activations — arrives as
    // `enabledToolIds`; seeding from it is what lets a repeated request
    // answer "Already active".
    const activatedIds: string[] = [...(context.enabledToolIds ?? [])];
    const emitActivationOutcome = async (input: {
      errorReason?: string;
      identifiers: string[];
      /**
       * What was activated. Only a skill belongs to the skill procedure
       * domain; a tool is reported as a tool, with no domain, so it leaves no
       * skill record, marker or receipt behind.
       */
      kind: 'skill' | 'tool';
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

      const isSkill = input.kind === 'skill';

      await emitToolOutcomeSafely({
        apiName: isSkill ? 'activateSkill' : 'activateTools',
        context: { agentId: context.agentId, userId: context.userId },
        domainKey: isSkill ? 'skill:builtin-skill' : undefined,
        errorReason: input.errorReason,
        identifier: LobeActivatorIdentifier,
        intentClass: 'tool_command',
        messageId: context.messageId,
        operationId: context.operationId,
        policyStateStore: redisPolicyStateStore,
        relatedObjects: input.identifiers.map((id) => ({
          objectId: id,
          objectType: input.kind,
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

    // Share the full skill-activation runtime with `lobe-skills` so the
    // `activateTools` skill fallback resolves agent-document, filesystem
    // (project/device), and user-library skills under the exact same gates.
    let skillsRuntime: SkillsExecutionRuntime | undefined;
    if (context.serverDB && context.userId) {
      skillsRuntime = await createSkillActivationRuntime({
        ...context,
        serverDB: context.serverDB,
        userId: context.userId,
      });
    }

    const service: ActivatorRuntimeService = {
      activateSkill: skillsRuntime
        ? async (args) => {
            try {
              const result = await skillsRuntime!.activateSkill(args);
              await emitActivationOutcome({
                identifiers: [args.name],
                kind: 'skill',
                status: 'succeeded',
                summary: 'Activator selected a skill.',
              });
              return result;
            } catch (error) {
              await emitActivationOutcome({
                errorReason: (error as Error).message,
                identifiers: [args.name],
                kind: 'skill',
                status: 'failed',
                summary: 'Activator failed to select a skill.',
              });
              throw error;
            }
          }
        : undefined,
      // A device-locked run walls the picker off, so activating it can only fail;
      // say why, so the model sends the user to the device selector instead.
      explainNotFound: (identifier) =>
        identifier === REMOTE_DEVICE_TOOL_IDENTIFIER && context.executionPlan
          ? describeLockedDevicePicker(context.executionPlan)
          : undefined,
      getActivatedToolIds: () => [...activatedIds],
      getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
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
            // Passed through for wire-name matching: non-builtin types
            // (`mcp`, `standalone`) append a `____<type>` segment to the
            // offered wire name, so resolving a copied name needs it.
            identifier: manifest.identifier,
            name: manifest.meta?.title ?? manifest.identifier,
            systemRole: manifest.systemRole,
            type: manifest.type,
          });
        }

        return results;
      },
      // Full discoverable list, for inverting `MD5HASH_…` wire-name segments
      // and resolving bare API names: neither can be probed against the
      // identifier-keyed map, so the runtime hashes every discoverable
      // identifier locally and matches the generated wire-name variants. Same
      // scoping as `getToolManifests` — the map only holds discoverable tools.
      listToolManifests: async (): Promise<ToolManifestInfo[]> =>
        Object.values(context.toolManifestMap ?? {}).map((manifest) => ({
          apiDescriptions: manifest.api.map((a) => ({ description: a.description, name: a.name })),
          identifier: manifest.identifier,
          name: manifest.meta?.title ?? manifest.identifier,
          systemRole: manifest.systemRole,
          type: manifest.type,
        })),
      markActivated: (identifiers: string[]) => {
        for (const id of identifiers) {
          if (!activatedIds.includes(id)) {
            activatedIds.push(id);
          }
        }
        void emitActivationOutcome({
          identifiers,
          kind: 'tool',
          status: 'succeeded',
          summary: 'Activator activated tools.',
        }).catch((error) => {
          console.error('[AgentSignal] Failed to emit activator outcome:', error);
        });
      },
    };

    return new ActivatorExecutionRuntime({ service });
  },
  identifier: LobeActivatorIdentifier,
};
