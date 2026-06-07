import type { AgentSignalRuntimeService } from '@lobechat/builtin-tool-agent-signal';

import type { LobeChatDatabase } from '@/database/type';
import { runMemoryActionAgent } from '@/server/services/agentSignal/policies/analyzeIntent/actions/userMemory';
import type { SkillManagementDocumentService } from '@/server/services/skillManagement';

import { createSelfReviewProposalPreflightService } from '../review/proposalPreflight';
import { createSelfReviewProposalSnapshotService } from '../review/proposalSnapshot';
import { Risk } from '../types';
import type {
  CreateSkillIfAbsentInput,
  ReplaceSkillContentCASInput,
  WriteMemoryInput,
} from './shared';
import { createMemoryService, createSkillManagementService } from './shared';

export interface ResourceRuntimePrimitiveDeps {
  agentId: string;
  db: LobeChatDatabase;
  /** Builds the memory-candidate reason; lets each mode tag its origin. */
  memoryReason: (evidenceCount: number) => string;
  skillDocumentService: SkillManagementDocumentService;
  userId: string;
}

/**
 * Builds the resource tool primitives shared by the reflection and
 * self-feedback-intent execAgent runtimes — safe live-DB skill reads / writes
 * plus user-memory writes, keyed to match the advertised resource api names.
 *
 * Pure like the review primitives: no `reserveOperation` / receipt /
 * `completeOperation` side channel (idempotency + receipt projection live on
 * the completion path), and no `getEvidenceDigest` — evidence is embedded in
 * the agent's prompt, so these tools only touch live state.
 */
export const createResourceRuntimePrimitives = ({
  agentId,
  db,
  memoryReason,
  skillDocumentService,
  userId,
}: ResourceRuntimePrimitiveDeps): AgentSignalRuntimeService => {
  const isSkillNameAvailable = async ({
    agentId: targetAgentId,
    name,
  }: {
    agentId?: string;
    name: string;
  }) => {
    const skills = await skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });

    return !skills.some((skill) => skill.name === name);
  };
  const readSkillTargetSnapshot = (skillDocumentId: string) =>
    skillDocumentService.readSkillTargetSnapshot({ agentDocumentId: skillDocumentId, agentId });

  const proposalPreflight = createSelfReviewProposalPreflightService({
    isSkillNameAvailable,
    readSkillTargetSnapshot,
  });
  const proposalSnapshot = createSelfReviewProposalSnapshotService({
    isSkillNameAvailable,
    readSkillTargetSnapshot,
  });

  const skillService = createSkillManagementService({
    createSkill: async ({ input }) => {
      const result = await skillDocumentService.createSkill({
        agentId,
        bodyMarkdown: input.bodyMarkdown ?? '',
        description: input.description ?? 'Agent Signal managed skill.',
        name: input.name ?? input.title ?? 'agent-signal-skill',
        title: input.title ?? input.name ?? 'Agent Signal skill',
      });

      return {
        skillDocumentId: result.bundle.agentDocumentId,
        summary: `Created managed skill ${result.name}.`,
      };
    },
    refineSkill: async ({ input }) => {
      const result = await skillDocumentService.replaceSkillIndex({
        agentDocumentId: input.skillDocumentId,
        agentId,
        bodyMarkdown: input.bodyMarkdown ?? '',
      });

      if (!result) throw new Error('Skill target not found');

      return {
        skillDocumentId: result.bundle.agentDocumentId,
        summary: `Refined managed skill ${result.name}.`,
      };
    },
  });

  return {
    createSkillIfAbsent: async (rawInput) => {
      const input = rawInput as unknown as CreateSkillIfAbsentInput;
      const result = await skillService.createSkill({
        evidenceRefs: [],
        idempotencyKey: input.idempotencyKey,
        input,
      });

      return { resourceId: result.skillDocumentId, summary: result.summary };
    },
    getManagedSkill: async (rawInput) => {
      const { agentId: targetAgentId, skillDocumentId } = rawInput as {
        agentId?: string;
        skillDocumentId: string;
      };

      return skillDocumentService.getSkill({
        agentDocumentId: skillDocumentId,
        agentId: targetAgentId ?? agentId,
        includeContent: true,
      });
    },
    listManagedSkills: async (rawInput) => {
      const { agentId: targetAgentId } = rawInput as { agentId?: string };

      return skillDocumentService.listSkills({ agentId: targetAgentId ?? agentId });
    },
    replaceSkillContentCAS: async (rawInput) => {
      const input = rawInput as unknown as ReplaceSkillContentCASInput;
      const baseSnapshot = await proposalSnapshot.captureActionSnapshot({
        actionType: 'refine_skill',
        agentId,
        input: { skillDocumentId: input.skillDocumentId },
        userId,
      });
      const enriched = {
        ...input,
        baseSnapshot,
        skillDocumentId: baseSnapshot.agentDocumentId ?? input.skillDocumentId,
      };

      const preflight = await proposalPreflight.checkAction({
        actionType: 'refine_skill',
        baseSnapshot: enriched.baseSnapshot,
        evidenceRefs: [],
        idempotencyKey: enriched.idempotencyKey,
        operation: {
          domain: 'skill',
          input: {
            bodyMarkdown: enriched.bodyMarkdown,
            patch: enriched.summary,
            skillDocumentId: enriched.skillDocumentId,
            userId: enriched.userId,
          },
          operation: 'refine',
        },
        rationale: enriched.summary ?? `Refine managed skill ${enriched.skillDocumentId}.`,
        risk: Risk.Low,
        target: { skillDocumentId: enriched.skillDocumentId },
      });

      if (!preflight.allowed) {
        return {
          resourceId: enriched.skillDocumentId,
          status: 'skipped_stale',
          summary: preflight.reason || enriched.summary,
        };
      }

      const result = await skillService.refineSkill({
        evidenceRefs: [],
        idempotencyKey: enriched.idempotencyKey,
        input: enriched,
      });

      return { resourceId: result.skillDocumentId, summary: result.summary };
    },
    writeMemory: async (rawInput) => {
      const input = rawInput as unknown as WriteMemoryInput;
      const memoryService = createMemoryService({
        writeMemory: async ({ content, evidenceRefs, idempotencyKey }) => {
          const result = await runMemoryActionAgent(
            { agentId, message: content, reason: memoryReason(evidenceRefs.length) },
            { db, userId },
          );

          if (result.status !== 'applied') {
            throw new Error(
              result.detail ?? 'Memory action agent did not apply a durable memory write.',
            );
          }

          return { memoryId: idempotencyKey, summary: result.detail ?? content };
        },
      });
      const result = await memoryService.writeMemory({
        evidenceRefs: input.evidenceRefs,
        idempotencyKey: input.idempotencyKey,
        input: { content: input.content, userId: input.userId },
      });

      return { resourceId: result.memoryId, summary: result.summary };
    },
  };
};
