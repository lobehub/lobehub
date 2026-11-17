import type { AgentInterventionInteractionKind } from '@lobechat/agent-gateway-client';
import type { HeteroPermissionMode } from '@lobechat/types';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import { resolveClaudeCodePermissionMode } from './args';
import {
  buildClaudeCodePermissionIntervention,
  type ClaudeCodePermissionRequest,
  type ClaudeCodePermissionResult,
  claudeCodePermissionToolCallId,
  parseClaudeCodePermissionRequest,
  resolveClaudeCodePermissionDecision,
} from './request';

/** Raises one card and waits for the user's answer. */
export type ClaudeCodePermissionAsk = (intervention: {
  arguments: unknown;
  interactionKind: AgentInterventionInteractionKind;
  toolCallId: string;
}) => Promise<InterventionAnswer>;

/**
 * Ask through an `AskUserBridge` without a deadline: a permission request waits
 * for the user however long it takes (stopping the run ends it).
 */
export const askThroughBridge =
  (bridge: AskUserBridge): ClaudeCodePermissionAsk =>
  (intervention) =>
    bridge.pending(intervention, { timeoutMs: Number.POSITIVE_INFINITY });

/**
 * Answer one permission request: raise its card, wait, and turn the answer into
 * Claude Code's decision. Shared by the stdio responder and the SDK's
 * `canUseTool`, so both paths decide alike.
 */
export const decideClaudeCodePermission = async (
  request: ClaudeCodePermissionRequest,
  ask: ClaudeCodePermissionAsk,
  { isRoot = false }: { isRoot?: boolean } = {},
): Promise<ClaudeCodePermissionResult> => {
  const intervention = buildClaudeCodePermissionIntervention(request, { isRoot });
  let answer: InterventionAnswer;
  try {
    answer = await ask(intervention);
  } catch {
    answer = { cancelled: true, cancelReason: 'session_ended' };
  }
  return resolveClaudeCodePermissionDecision(request, answer, { isRoot });
};

/** The slice of a live Claude Code stdin the responder writes through. */
export interface ClaudeCodePermissionTransport {
  respondToControlRequest: (requestId: string, response: Record<string, unknown>) => boolean;
  subscribe: (listener: (message: unknown) => void) => () => void;
}

export interface ClaudeCodePermissionResponderOptions {
  ask: ClaudeCodePermissionAsk;
  /** Withdraw a card Claude Code no longer waits for (`control_cancel_request`). */
  cancel?: (toolCallId: string) => void;
  isRoot?: boolean;
}

/**
 * Host side of `--permission-prompt-tool stdio`: answers every `can_use_tool`
 * control request Claude Code writes to stdout with a `control_response` on
 * stdin, after the user decides on a card.
 *
 * @returns a detach function
 */
export const attachClaudeCodePermissionResponder = (
  transport: ClaudeCodePermissionTransport,
  { ask, cancel, isRoot = false }: ClaudeCodePermissionResponderOptions,
): (() => void) =>
  transport.subscribe((message) => {
    const record = message as { request_id?: unknown; type?: unknown } | undefined;
    if (record?.type === 'control_cancel_request' && typeof record.request_id === 'string') {
      cancel?.(claudeCodePermissionToolCallId(record.request_id));
      return;
    }

    const request = parseClaudeCodePermissionRequest(message);
    if (!request) return;
    void decideClaudeCodePermission(request, ask, { isRoot }).then((decision) => {
      transport.respondToControlRequest(request.requestId, {
        ...decision,
        ...(request.toolUseId && { toolUseID: request.toolUseId }),
      });
    });
  });

/**
 * The `set_permission_mode` control request for a mode the user picked mid-run,
 * adjusted to what Claude Code can run (root has no `bypassPermissions`).
 */
export const buildSetPermissionModeRequest = (
  mode: HeteroPermissionMode,
  isRoot?: boolean,
): { mode: HeteroPermissionMode; subtype: 'set_permission_mode' } => ({
  mode: resolveClaudeCodePermissionMode(mode, isRoot).mode,
  subtype: 'set_permission_mode',
});
