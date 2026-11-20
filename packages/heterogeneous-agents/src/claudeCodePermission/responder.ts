import type { AgentInterventionInteractionKind } from '@lobechat/agent-gateway-client';
import type { HeteroPermissionMode } from '@lobechat/types';

import type { AskUserBridge, InterventionAnswer } from '../askUser/AskUserBridge';
import {
  type ClaudeCodeControlRequest,
  type ClaudeCodeControlRequestHandle,
  CONTROL_REQUEST_HOST_META,
} from '../spawn/claudeCodeLiveInput';
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
): {
  [CONTROL_REQUEST_HOST_META]: { requestedMode: HeteroPermissionMode };
  mode: HeteroPermissionMode;
  subtype: 'set_permission_mode';
} => ({
  // The pick itself, for the host's mode report; never sent to Claude Code.
  [CONTROL_REQUEST_HOST_META]: { requestedMode: mode },
  mode: resolveClaudeCodePermissionMode(mode, isRoot).mode,
  subtype: 'set_permission_mode',
});

/** How long Claude Code gets to confirm a mode switch. */
export const SET_PERMISSION_MODE_TIMEOUT_MS = 10_000;

/**
 * Switch a live CLI session's mode: write `set_permission_mode` into its stdin
 * and wait for Claude Code to confirm. The mode report follows on stdout.
 *
 * @param send Writes a control request; `undefined` once input has closed.
 * @returns the mode Claude Code switched to
 * @throws When input is closed, Claude Code refuses or never answers, or `signal` aborts.
 */
export const setClaudeCodePermissionMode = async (
  send: (request: ClaudeCodeControlRequest) => ClaudeCodeControlRequestHandle | undefined,
  mode: HeteroPermissionMode,
  {
    isRoot,
    signal,
    timeoutMs = SET_PERMISSION_MODE_TIMEOUT_MS,
  }: { isRoot?: boolean; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HeteroPermissionMode> => {
  const request = buildSetPermissionModeRequest(mode, isRoot);
  const sent = send(request);
  if (!sent) throw new Error('The Claude Code session no longer takes input');

  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  const cutOff = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Claude Code did not confirm the mode switch in time')),
      timeoutMs,
    );
    onAbort = () => reject(new Error('The run ended before Claude Code confirmed the mode'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const answer = await Promise.race([sent.response, cutOff]);
    if (answer.subtype === 'error') throw new Error(answer.error);
    return request.mode;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
};
