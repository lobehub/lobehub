import type { AgentRuntimeContext } from '@lobechat/agent-runtime';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import type { LobeChatDatabase } from '@/database/type';

import { hookDispatcher } from './hooks';

const log = debug('lobe-server:human-intervention-handler');

export interface InterventionInput {
  approvedToolCall?: any;
  humanInput?: any;
  rejectAndContinue?: boolean;
  rejectionReason?: string;
  toolMessageId?: string;
}

export interface InterventionResult {
  newState: any;
  nextContext: AgentRuntimeContext | undefined;
}

/**
 * Owns the three branches of human intervention on a `waiting_for_human`
 * operation, mirroring `conversationControl.ts` on the client side:
 *
 * - `approveToolCalling` → write `intervention.status='approved'`, resume via
 *   `phase: 'human_approved_tool'` so the runtime short-circuits into
 *   `call_tool` with `skipCreateToolMessage: true`.
 * - `rejectAndContinueToolCalling` → write `intervention.status='rejected'`
 *   and resume via `phase: 'user_input'` once the rest of the batch is
 *   resolved, so the next LLM call treats the rejection as user feedback.
 * - `rejectToolCalling` (halt) → write `intervention.status='rejected'` and
 *   move to `status='interrupted'` with `interruption.reason='human_rejected'`.
 *
 * Each branch is a self-contained method so the routing in `process()` reads
 * top-to-bottom: detect approval, then rejection, then unsupported humanInput.
 */
export class HumanInterventionHandler {
  constructor(
    private readonly serverDB: LobeChatDatabase,
    private readonly messageModel: MessageModel,
  ) {}

  async process(state: any, intervention: InterventionInput): Promise<InterventionResult> {
    const { humanInput, approvedToolCall, rejectAndContinue, rejectionReason, toolMessageId } =
      intervention;

    if (approvedToolCall && state.status === 'waiting_for_human') {
      return this.approve(state, approvedToolCall, toolMessageId);
    }

    if (rejectionReason && state.status === 'waiting_for_human') {
      return this.reject(state, { rejectAndContinue, rejectionReason, toolMessageId });
    }

    // human_prompt / human_select (submitToolInteraction) — out of scope for
    // this codepath; the call site treats unrecognized intervention inputs as
    // a no-op and lets the regular step loop run.
    if (humanInput) {
      return { newState: state, nextContext: undefined };
    }

    return { newState: state, nextContext: undefined };
  }

  private async approve(
    state: any,
    approvedToolCall: any,
    toolMessageId: string | undefined,
  ): Promise<InterventionResult> {
    if (!toolMessageId) {
      log('approve requires toolMessageId, got undefined');
      return { newState: state, nextContext: undefined };
    }

    await this.messageModel.updateMessagePlugin(toolMessageId, {
      intervention: { status: 'approved' },
    });

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.pendingToolsCalling = (state.pendingToolsCalling ?? []).filter(
      (t: any) => t.id !== approvedToolCall.id,
    );
    // Keep waiting_for_human while other tools remain pending; resume to
    // running when this was the last one.
    newState.status = newState.pendingToolsCalling.length > 0 ? 'waiting_for_human' : 'running';

    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'afterHumanIntervention',
        {
          action: 'approve',
          operationId: state.metadata?.operationId ?? '',
          toolCallId: approvedToolCall.id,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    return {
      newState,
      nextContext: {
        payload: {
          approvedToolCall,
          parentMessageId: toolMessageId,
          skipCreateToolMessage: true,
        },
        phase: 'human_approved_tool',
      },
    };
  }

  private async reject(
    state: any,
    params: {
      rejectAndContinue?: boolean;
      rejectionReason: string;
      toolMessageId: string | undefined;
    },
  ): Promise<InterventionResult> {
    const { rejectAndContinue, rejectionReason, toolMessageId } = params;

    if (!toolMessageId) {
      log('reject requires toolMessageId, got undefined');
      return { newState: state, nextContext: undefined };
    }

    const rejectionContent = rejectionReason
      ? `User reject this tool calling with reason: ${rejectionReason}`
      : 'User reject this tool calling without reason';

    await this.messageModel.updateToolMessage(toolMessageId, { content: rejectionContent });
    await this.messageModel.updateMessagePlugin(toolMessageId, {
      intervention: { rejectedReason: rejectionReason, status: 'rejected' },
    });

    // Find the tool_call_id for this tool message so we can drop it from
    // pendingToolsCalling. pendingToolsCalling holds ChatToolPayload[] whose
    // id === tool_call_id; the mapping lives in messagePlugins (plugin id
    // === message id, toolCallId is a separate column).
    const rejectedToolCallId = await this.lookupToolCallId(toolMessageId);

    const newState = structuredClone(state);
    newState.lastModified = new Date().toISOString();
    newState.pendingToolsCalling = rejectedToolCallId
      ? (state.pendingToolsCalling ?? []).filter((t: any) => t.id !== rejectedToolCallId)
      : (state.pendingToolsCalling ?? []);

    if (rejectAndContinue) {
      return this.rejectAndContinue(state, newState, rejectionReason, rejectedToolCallId);
    }

    return this.rejectAndHalt(state, newState, rejectionReason, rejectedToolCallId);
  }

  /**
   * Persist the rejection, then either (a) wait for the remaining pending
   * tools to be resolved or (b) resume LLM once this is the last one.
   * Returning a `phase: 'user_input'` nextContext while pendingToolsCalling
   * is non-empty would cause executeStep to run runtime.step immediately,
   * resuming the LLM with an unresolved batch — see LOBE-7151 review P1.
   */
  private rejectAndContinue(
    state: any,
    newState: any,
    rejectionReason: string,
    rejectedToolCallId: string | undefined,
  ): InterventionResult {
    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'afterHumanIntervention',
        {
          action: 'rejectAndContinue',
          operationId: state.metadata?.operationId ?? '',
          rejectionReason,
          toolCallId: rejectedToolCallId,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    if (newState.pendingToolsCalling.length > 0) {
      newState.status = 'waiting_for_human';
      return { newState, nextContext: undefined };
    }

    newState.status = 'running';
    return { newState, nextContext: { phase: 'user_input' } };
  }

  /**
   * Halt: use `interrupted` + `reason='human_rejected'` to reuse the existing
   * terminal-state plumbing (early-exit, completion hooks, etc).
   */
  private rejectAndHalt(
    state: any,
    newState: any,
    rejectionReason: string,
    rejectedToolCallId: string | undefined,
  ): InterventionResult {
    hookDispatcher
      .dispatch(
        state.metadata?.operationId ?? '',
        'onStopByHumanIntervention',
        {
          operationId: state.metadata?.operationId ?? '',
          rejectionReason,
          toolCallId: rejectedToolCallId,
          userId: state.metadata?.userId,
        },
        state.metadata?._hooks,
      )
      .catch(() => {});

    newState.status = 'interrupted';
    newState.interruption = {
      canResume: false,
      interruptedAt: new Date().toISOString(),
      reason: 'human_rejected',
    };
    return { newState, nextContext: undefined };
  }

  private async lookupToolCallId(toolMessageId: string): Promise<string | undefined> {
    try {
      const plugin = await this.serverDB.query.messagePlugins.findFirst({
        where: (mp: any, { eq }: any) => eq(mp.id, toolMessageId),
      });
      return (plugin as any)?.toolCallId ?? undefined;
    } catch (error) {
      log('failed to look up tool plugin: %O', error);
      return undefined;
    }
  }
}
