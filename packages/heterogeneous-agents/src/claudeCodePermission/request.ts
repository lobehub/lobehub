import type { AgentInterventionInteractionKind } from '@lobechat/agent-gateway-client';

import type { InterventionAnswer } from '../askUser/AskUserBridge';

/**
 * A Claude Code permission rule change, as `can_use_tool` suggests it and an
 * answer applies it (the SDK's `PermissionUpdate`).
 */
export type ClaudeCodePermissionUpdate = Record<string, unknown> & {
  destination?: string;
  type: string;
};

/** One `can_use_tool` control request Claude Code sent its host. */
export interface ClaudeCodePermissionRequest {
  blockedPath?: string;
  decisionReason?: string;
  description?: string;
  displayName?: string;
  input: Record<string, unknown>;
  /** The control request id the answer must carry. */
  requestId: string;
  suggestions?: ClaudeCodePermissionUpdate[];
  title?: string;
  toolName: string;
  toolUseId?: string;
}

/** Claude Code's decision payload (the SDK's `PermissionResult`). */
export type ClaudeCodePermissionResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
      updatedPermissions?: ClaudeCodePermissionUpdate[];
    }
  | { behavior: 'deny'; interrupt?: boolean; message: string };

/** What the request asks: a tool run, or a switch into / out of plan mode. */
export type ClaudeCodePermissionKind = 'enterPlan' | 'exitPlan' | 'tool';

export const CLAUDE_CODE_PERMISSION_OPTION = {
  allow: 'allow',
  allowSession: 'allow_session',
  approveAcceptEdits: 'approve_accept_edits',
  approveBypass: 'approve_bypass',
  approveDefault: 'approve_default',
  deny: 'deny',
  keepPlanning: 'keep_planning',
} as const;

export type ClaudeCodePermissionOptionId =
  (typeof CLAUDE_CODE_PERMISSION_OPTION)[keyof typeof CLAUDE_CODE_PERMISSION_OPTION];

/** Answer key for the note a user adds to a denial or to "keep planning". */
export const CLAUDE_CODE_PERMISSION_NOTE_KEY = '__note';

/**
 * Detail the dedicated card renders, carried next to the AskUserQuestion-shaped
 * `questions` every intervention surface understands.
 */
export interface ClaudeCodePermissionDetail {
  allowedPrompts?: Array<{ prompt: string; tool: string }>;
  blockedPath?: string;
  decisionReason?: string;
  description?: string;
  displayName?: string;
  /** Shallow copy of the tool input with long strings cut. */
  input?: Record<string, unknown>;
  kind: ClaudeCodePermissionKind;
  options: ClaudeCodePermissionOptionId[];
  plan?: string;
  title?: string;
  toolName: string;
}

export interface ClaudeCodePermissionInterventionArgs {
  claudeCodePermission: ClaudeCodePermissionDetail;
  questions: Array<{
    header: string;
    multiSelect: false;
    options: Array<{ id: ClaudeCodePermissionOptionId; label: string }>;
    question: string;
  }>;
}

const MAX_PREVIEW_CHARS = 2000;
/** Review surfaces accept at most this much question text. */
const MAX_QUESTION_CHARS = 4000;

const OPTION_LABELS: Record<ClaudeCodePermissionOptionId, string> = {
  allow: 'Allow',
  allow_session: 'Always allow in this session',
  approve_accept_edits: 'Approve and auto-accept edits',
  approve_bypass: "Approve and don't ask again",
  approve_default: 'Approve and ask before each edit',
  deny: 'Deny',
  keep_planning: 'Keep planning',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The `can_use_tool` request in a parsed stdout line, if it is one. */
export const parseClaudeCodePermissionRequest = (
  message: unknown,
): ClaudeCodePermissionRequest | undefined => {
  if (!isRecord(message) || message.type !== 'control_request') return;
  const request = message.request;
  if (!isRecord(request) || request.subtype !== 'can_use_tool') return;
  if (typeof message.request_id !== 'string' || typeof request.tool_name !== 'string') return;

  return fromCanUseTool(message.request_id, request.tool_name, request.input, {
    blockedPath: request.blocked_path,
    decisionReason: request.decision_reason,
    description: request.description,
    displayName: request.display_name,
    suggestions: request.permission_suggestions,
    title: request.title,
    toolUseId: request.tool_use_id,
  });
};

/** The same request as the SDK's `canUseTool` callback receives it. */
export const fromCanUseTool = (
  requestId: string,
  toolName: string,
  input: unknown,
  extra: {
    blockedPath?: unknown;
    decisionReason?: unknown;
    description?: unknown;
    displayName?: unknown;
    suggestions?: unknown;
    title?: unknown;
    toolUseId?: unknown;
  },
): ClaudeCodePermissionRequest => ({
  blockedPath: optionalString(extra.blockedPath),
  decisionReason: optionalString(extra.decisionReason),
  description: optionalString(extra.description),
  displayName: optionalString(extra.displayName),
  input: isRecord(input) ? input : {},
  requestId,
  suggestions: Array.isArray(extra.suggestions)
    ? (extra.suggestions.filter(
        (entry) => isRecord(entry) && typeof entry.type === 'string',
      ) as ClaudeCodePermissionUpdate[])
    : undefined,
  title: optionalString(extra.title),
  toolName,
  toolUseId: optionalString(extra.toolUseId),
});

export const classifyClaudeCodePermission = (toolName: string): ClaudeCodePermissionKind =>
  toolName === 'ExitPlanMode' ? 'exitPlan' : toolName === 'EnterPlanMode' ? 'enterPlan' : 'tool';

const previewInput = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === 'string' ? cut(value, MAX_PREVIEW_CHARS) : value,
    ]),
  );

const readAllowedPrompts = (input: Record<string, unknown>) => {
  if (!Array.isArray(input.allowedPrompts)) return;
  const prompts = input.allowedPrompts.flatMap((entry) =>
    isRecord(entry) && typeof entry.prompt === 'string'
      ? [{ prompt: entry.prompt, tool: typeof entry.tool === 'string' ? entry.tool : 'Bash' }]
      : [],
  );
  return prompts.length > 0 ? prompts : undefined;
};

const optionsFor = (
  kind: ClaudeCodePermissionKind,
  request: ClaudeCodePermissionRequest,
  isRoot: boolean,
): ClaudeCodePermissionOptionId[] => {
  const o = CLAUDE_CODE_PERMISSION_OPTION;
  if (kind === 'exitPlan') {
    // "Don't ask again" is `bypassPermissions`, which root cannot run.
    return [
      ...(isRoot ? [] : [o.approveBypass]),
      o.approveAcceptEdits,
      o.approveDefault,
      o.keepPlanning,
    ];
  }
  if (kind === 'enterPlan') return [o.allow, o.deny];
  return request.suggestions?.length ? [o.allow, o.allowSession, o.deny] : [o.allow, o.deny];
};

/** Stable card id per request, distinct from the tool the request is about. */
export const claudeCodePermissionToolCallId = (requestId: string): string =>
  `cc-permission-${requestId}`;

/**
 * The intervention a request raises: the AskUserQuestion-shaped question every
 * surface (card, durable review, notification) understands, plus the detail
 * the dedicated Claude Code card renders.
 */
export const buildClaudeCodePermissionIntervention = (
  request: ClaudeCodePermissionRequest,
  { isRoot = false }: { isRoot?: boolean } = {},
): {
  arguments: ClaudeCodePermissionInterventionArgs;
  interactionKind: AgentInterventionInteractionKind;
  toolCallId: string;
} => {
  const kind = classifyClaudeCodePermission(request.toolName);
  const options = optionsFor(kind, request, isRoot);
  const plan = kind === 'exitPlan' ? optionalString(request.input.plan) : undefined;
  const toolLabel = request.displayName ?? request.toolName;
  const question =
    kind === 'exitPlan'
      ? (plan ?? 'Claude has finished planning.')
      : kind === 'enterPlan'
        ? 'Claude wants to enter plan mode.'
        : (request.title ?? `Claude wants to use ${toolLabel}.`);

  return {
    arguments: {
      claudeCodePermission: {
        allowedPrompts: kind === 'exitPlan' ? readAllowedPrompts(request.input) : undefined,
        blockedPath: request.blockedPath,
        decisionReason: request.decisionReason,
        description: request.description,
        displayName: request.displayName,
        input: kind === 'tool' ? previewInput(request.input) : undefined,
        kind,
        options,
        plan,
        title: request.title,
        toolName: request.toolName,
      },
      questions: [
        {
          header: kind === 'exitPlan' ? 'Review plan' : cut(toolLabel, 200),
          multiSelect: false,
          options: options.map((id) => ({ id, label: OPTION_LABELS[id] })),
          question: cut(question, MAX_QUESTION_CHARS),
        },
      ],
    },
    interactionKind: kind === 'exitPlan' ? 'plan' : 'permission',
    toolCallId: claudeCodePermissionToolCallId(request.requestId),
  };
};

const readAnswer = (
  answer: InterventionAnswer,
  options: readonly string[],
): { note?: string; optionId?: string } => {
  if (answer.cancelled || !isRecord(answer.result)) return {};
  const values = Object.entries(answer.result)
    .filter(([key]) => key !== CLAUDE_CODE_PERMISSION_NOTE_KEY)
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
  const optionId = values.find(
    (value): value is string => typeof value === 'string' && options.includes(value),
  );
  const note = answer.result[CLAUDE_CODE_PERMISSION_NOTE_KEY];
  return { note: typeof note === 'string' && note.trim() ? note.trim() : undefined, optionId };
};

const setMode = (mode: string): ClaudeCodePermissionUpdate => ({
  destination: 'session',
  mode,
  type: 'setMode',
});

/**
 * Turn the user's answer into Claude Code's decision.
 *
 * - "Always allow in this session" applies Claude Code's own suggestions, kept
 *   to this session whatever destination it proposed.
 * - A denial without a note interrupts the turn, like "No" in Claude Code's
 *   terminal: the user says what to do next. With a note Claude carries on
 *   with it. "Keep planning" works the same way.
 * - No answer (the run stopped, the card was dismissed) denies and interrupts.
 */
export const resolveClaudeCodePermissionDecision = (
  request: ClaudeCodePermissionRequest,
  answer: InterventionAnswer,
  { isRoot = false }: { isRoot?: boolean } = {},
): ClaudeCodePermissionResult => {
  const o = CLAUDE_CODE_PERMISSION_OPTION;
  const kind = classifyClaudeCodePermission(request.toolName);
  const { note, optionId } = readAnswer(answer, optionsFor(kind, request, isRoot));
  const allow = (
    updatedPermissions?: ClaudeCodePermissionUpdate[],
  ): ClaudeCodePermissionResult => ({
    behavior: 'allow',
    // Required: an allow without the input reads to Claude Code as a failed callback.
    updatedInput: request.input,
    ...(updatedPermissions?.length ? { updatedPermissions } : {}),
  });

  switch (optionId) {
    case o.allow: {
      return allow();
    }
    case o.allowSession: {
      return allow(
        request.suggestions?.map((suggestion) => ({ ...suggestion, destination: 'session' })),
      );
    }
    case o.approveBypass: {
      return allow([setMode('bypassPermissions')]);
    }
    case o.approveAcceptEdits: {
      return allow([setMode('acceptEdits')]);
    }
    case o.approveDefault: {
      return allow([setMode('default')]);
    }
    case o.keepPlanning: {
      return note
        ? { behavior: 'deny', message: `The user wants to keep planning. Revise the plan: ${note}` }
        : {
            behavior: 'deny',
            interrupt: true,
            message: 'The user wants to keep planning and will say what to change.',
          };
    }
    case o.deny: {
      return note
        ? { behavior: 'deny', message: `The user denied this: ${note}` }
        : { behavior: 'deny', interrupt: true, message: 'The user denied this.' };
    }
    default: {
      return {
        behavior: 'deny',
        interrupt: true,
        message: 'The user stopped the run before answering.',
      };
    }
  }
};
