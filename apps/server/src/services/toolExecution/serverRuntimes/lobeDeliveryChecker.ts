import { LobeDeliveryCheckerIdentifier } from '@lobechat/builtin-tool-lobe-delivery-checker';
import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type { LobeChatDatabase } from '@/database/type';

import type { ServerRuntimeRegistration } from './types';

interface LobeDeliveryCheckerRuntimeContext {
  /** The current Agent Run (`agent_operations.id`) — the verify plan attaches to it. */
  operationId?: string;
  serverDB: LobeChatDatabase;
  userId: string;
}

const buildError = (content: string, code: string): BuiltinServerRuntimeOutput => ({
  content,
  error: { code, message: content },
  success: false,
});

/**
 * Server runtime for the delivery-checker tool. The agent calls
 * `generateVerifyPlan` (post-approval) enumerating the checks the deliverable
 * must satisfy; this creates the criteria + a reusable rubric and snapshots them
 * onto the current Agent Run so the checks run automatically when it completes.
 */
class LobeDeliveryCheckerExecutionRuntime {
  private operationId?: string;
  private db: LobeChatDatabase;
  private userId: string;

  constructor(context: LobeDeliveryCheckerRuntimeContext) {
    this.operationId = context.operationId;
    this.db = context.serverDB;
    this.userId = context.userId;
  }

  generateVerifyPlan = async (params: {
    criteria?: {
      description?: string;
      instruction?: string;
      onFail?: 'manual' | 'auto_repair';
      required?: boolean;
      title: string;
      verifierType?: 'program' | 'agent' | 'llm';
    }[];
    title: string;
  }): Promise<BuiltinServerRuntimeOutput> => {
    if (!this.operationId) {
      return buildError(
        'Verify plan generation requires an active Agent Run operation.',
        'NO_OPERATION',
      );
    }
    if (!params.title || typeof params.title !== 'string' || !params.title.trim()) {
      return buildError('title is required.', 'INVALID_ARGUMENTS');
    }
    const criteria = (params.criteria ?? []).filter((c) => c?.title?.trim());
    if (criteria.length === 0) {
      return buildError('At least one criterion with a title is required.', 'INVALID_ARGUMENTS');
    }

    // Agent-authored path: the model enumerated the checks, so create the
    // criteria + a rubric, snapshot it onto this operation, and confirm it. The
    // tool call is human-reviewed (humanIntervention); this runs post-approval.
    const { VerifyPlanGeneratorService } = await import('@/server/services/verify');
    const planGenerator = new VerifyPlanGeneratorService(this.db, this.userId);
    const { items, rubricId } = await planGenerator.createPlanFromCriteria({
      criteria,
      operationId: this.operationId,
      title: params.title,
    });

    return {
      content: `Created delivery standard "${params.title}" with ${items.length} check(s): ${items
        .map((i) => `${i.title}${i.required ? ' (gate)' : ''}`)
        .join(
          '; ',
        )}. The checks run automatically when this operation completes — do not run them yourself.`,
      state: {
        items: items.map((i) => ({
          // Surface the persisted ids so the client can write edits back to the
          // criterion row (and its instruction document) from the portal.
          criterionId: i.sourceCriterionId ?? undefined,
          description: i.description,
          documentId: i.documentId,
          onFail: i.onFail,
          required: i.required,
          title: i.title,
          verifierType: i.verifierType,
        })),
        rubricId,
        title: params.title,
      },
      success: true,
    };
  };
}

export const lobeDeliveryCheckerRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Delivery Checker execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Delivery Checker execution');
    }

    return new LobeDeliveryCheckerExecutionRuntime({
      operationId: context.operationId,
      serverDB: context.serverDB,
      userId: context.userId,
    });
  },
  identifier: LobeDeliveryCheckerIdentifier,
};
