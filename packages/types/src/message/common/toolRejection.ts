/**
 * Why a person rejected a tool call.
 *
 * The durable resolution contract carries a single `reason` string, so the
 * structured part travels inside it as a `[code] text` prefix: the model reads
 * it as plain language, and analytics can group on the code with a prefix match.
 */
export const TOOL_REJECTION_REASON_CODES = [
  'not_needed',
  'wrong_arguments',
  'too_risky',
  'other',
  'unspecified',
] as const;

export type ToolRejectionReasonCode = (typeof TOOL_REJECTION_REASON_CODES)[number];

/** The codes a person can pick directly; the other two are derived. */
export const TOOL_REJECTION_PRESET_CODES = [
  'not_needed',
  'wrong_arguments',
  'too_risky',
] as const satisfies readonly ToolRejectionReasonCode[];

export type ToolRejectionPresetCode = (typeof TOOL_REJECTION_PRESET_CODES)[number];

const TOOL_REJECTION_DEFAULT_TEXT: Record<ToolRejectionReasonCode, string> = {
  not_needed: 'This action is not needed.',
  other: 'The user rejected this call for another reason.',
  too_risky: 'This action is too risky.',
  unspecified: 'The user rejected this call without giving a specific reason.',
  wrong_arguments: 'The arguments of this call are wrong.',
};

/** Stored on the row of a retry the runtime blocked after a person rejected that tool. */
export const TOOL_REJECTION_RETRY_BLOCKED_REASON = 'tool_rejected_by_user';

const USER_REJECTION_CONTENT_PREFIX = 'User reject this tool calling';
const REASON_PATTERN = /^\[([a-z_]+)]\s*([\s\S]*)$/;

export const buildToolRejectionReason = (code: ToolRejectionReasonCode, note?: string): string =>
  `[${code}] ${note?.trim() || TOOL_REJECTION_DEFAULT_TEXT[code]}`;

/** Combines what the approval card collected into the stored reason. */
export const composeToolRejectionReason = (params: {
  code?: ToolRejectionPresetCode;
  note?: string;
}): string => {
  const note = params.note?.trim();
  if (params.code) return buildToolRejectionReason(params.code, note);
  return buildToolRejectionReason(note ? 'other' : 'unspecified', note);
};

/** Every rejection path goes through this, so a stored reason is never empty. */
export const normalizeToolRejectionReason = (reason?: string | null): string =>
  reason?.trim() || buildToolRejectionReason('unspecified');

export const parseToolRejectionReason = (
  reason: string,
): { code?: ToolRejectionReasonCode; isDefaultText: boolean; text: string } => {
  const match = REASON_PATTERN.exec(reason);
  const code = TOOL_REJECTION_REASON_CODES.find((item) => item === match?.[1]);
  if (!code) return { isDefaultText: false, text: reason };

  const text = match![2].trim() || TOOL_REJECTION_DEFAULT_TEXT[code];
  return { code, isDefaultText: text === TOOL_REJECTION_DEFAULT_TEXT[code], text };
};

/** The tool result the model reads for a rejected call. */
export const formatToolRejectionContent = (reason?: string | null): string =>
  `${USER_REJECTION_CONTENT_PREFIX} with reason: ${normalizeToolRejectionReason(reason)}`;

/** The stored reason and the model-facing content for one rejection. */
export const resolveToolRejection = (reason?: string | null) => ({
  content: formatToolRejectionContent(reason),
  reason: normalizeToolRejectionReason(reason),
});

/** Also matches rows written before reasons became mandatory. */
export const isUserToolRejectionContent = (content: unknown): boolean =>
  typeof content === 'string' && content.startsWith(USER_REJECTION_CONTENT_PREFIX);
