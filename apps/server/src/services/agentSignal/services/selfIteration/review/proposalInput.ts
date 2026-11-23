import { isRecord, pickTrimmedString, safeParseJSON } from '@lobechat/utils';

import type { CreateSelfReviewProposalInput } from '../tools/shared';

/** Action types a `createSelfReviewProposal` action may carry. */
export const SELF_REVIEW_PROPOSAL_ACTION_TYPES = [
  'create_skill',
  'refine_skill',
  'consolidate_skill',
  'refine_prompt',
  'write_memory',
  'proposal_only',
] as const;

const SELF_REVIEW_PROPOSAL_ACTION_TYPE_ALIASES: Record<string, string> = {
  record_idea: 'proposal_only',
};

/** Required tool-schema fields that sit beside `actions`, not inside it. */
const TOP_LEVEL_PROPOSAL_FIELDS = ['idempotencyKey', 'proposalKey', 'summary'] as const;

/** Problems listed per error; the rest are counted so the message stays readable. */
const MAX_LISTED_PROBLEMS = 5;

const EXPECTED_ACTION_TYPES = `expected one of: ${SELF_REVIEW_PROPOSAL_ACTION_TYPES.join(', ')}`;

const getRawActionType = (action: Record<PropertyKey, unknown>) =>
  pickTrimmedString(action.actionType) ?? pickTrimmedString(action.type);

const describeValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length} item(s)`;
  if (typeof value === 'string') {
    const preview = value.length > 40 ? `${value.slice(0, 40)}…` : value;

    return `the string ${JSON.stringify(preview)}`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);

    return keys.length > 0 ? `an object with keys ${keys.join(', ')}` : 'an empty object';
  }

  return `the ${typeof value} ${String(value)}`;
};

/**
 * Coerces the unambiguous non-array shapes models send for `actions`.
 *
 * - A JSON string holding the array (or one action): some models double-encode nested arrays.
 * - One action object instead of a one-element array.
 *
 * Anything else is returned as-is for the validator to reject with a precise reason.
 */
const coerceActions = (value: unknown): unknown => {
  const decoded = typeof value === 'string' ? (safeParseJSON<unknown>(value) ?? value) : value;

  if (isRecord(decoded) && getRawActionType(decoded)) return [decoded];

  return decoded;
};

const describeActionProblem = (rawAction: unknown, index: number): string | undefined => {
  if (!isRecord(rawAction)) {
    return `actions[${index}] is ${describeValue(rawAction)}, not an action object`;
  }

  const rawType = getRawActionType(rawAction);
  if (!rawType) {
    const keys = Object.keys(rawAction);

    return `actions[${index}] has no actionType (${keys.length > 0 ? `keys: ${keys.join(', ')}` : 'empty object'})`;
  }

  const actionType = SELF_REVIEW_PROPOSAL_ACTION_TYPE_ALIASES[rawType] ?? rawType;
  if (!(SELF_REVIEW_PROPOSAL_ACTION_TYPES as readonly string[]).includes(actionType)) {
    return `actions[${index}] has unsupported actionType "${rawType}"`;
  }
};

const buildInvalidActionsMessage = ({
  actions,
  input,
  problems,
}: {
  actions: unknown[];
  input: Record<PropertyKey, unknown>;
  problems: string[];
}) => {
  const objectCount = actions.filter(isRecord).length;
  const listed = problems.slice(0, MAX_LISTED_PROBLEMS);
  const remaining = problems.length - listed.length;
  const missingTopLevelFields = TOP_LEVEL_PROPOSAL_FIELDS.filter(
    (field) => !pickTrimmedString(input[field]),
  );

  return [
    `Received actions with ${actions.length} item(s) (${objectCount} object(s)): ${listed.join('; ')}${remaining > 0 ? `; and ${remaining} more` : ''}.`,
    // NOTICE:
    // Production calls arrived as one complete action object followed by bare strings, e.g.
    // `[{ actionType, target, operation }, "rationale?", "summary?", "idempotencyKey?"]`: the
    // model closed the object early and the rest of the call spilled into the array. Saying only
    // "actions[1] has no actionType" made models report a phantom second action and resend the
    // same shape, so the message names the stray value and the fields that went missing.
    ...(objectCount > 0 && objectCount < actions.length
      ? [
          'Every actions item must be one complete action object; stray values after an action object usually mean the object was closed too early.',
        ]
      : []),
    ...(missingTopLevelFields.length > 0
      ? [
          `Top-level fields ${missingTopLevelFields.join(', ')} are missing; they belong beside actions, not inside it.`,
        ]
      : []),
    `Each action needs actionType (${EXPECTED_ACTION_TYPES}). Resend the whole call with corrected arguments.`,
  ].join(' ');
};

/**
 * Normalizes model-authored proposal actions before projection.
 *
 * Models routinely send the action kind as `type` (and the legacy prompt named
 * ideas `record_idea`); the projection only reads `actionType`, so those
 * proposals silently projected to nothing and every nightly review ended
 * without a brief. Unambiguous shape slips (one action object, a JSON-encoded
 * array) are coerced; anything else fails loudly with every offending index and
 * what it holds, so the model can repair the call in one retry.
 */
export const normalizeSelfReviewProposalInput = (
  input: CreateSelfReviewProposalInput,
): CreateSelfReviewProposalInput => {
  if (input.actions === undefined || input.actions === null) return input;

  const actions = coerceActions(input.actions);

  if (!Array.isArray(actions)) {
    throw new TypeError(
      `actions must be an array of action objects, but received ${describeValue(actions)}. Each action needs actionType (${EXPECTED_ACTION_TYPES}).`,
    );
  }

  const problems = actions.flatMap((rawAction, index) => {
    const problem = describeActionProblem(rawAction, index);

    return problem ? [problem] : [];
  });

  if (problems.length > 0) {
    throw new Error(
      buildInvalidActionsMessage({
        actions,
        input: input as unknown as Record<PropertyKey, unknown>,
        problems,
      }),
    );
  }

  return {
    ...input,
    actions: actions.map((rawAction) => {
      const action = rawAction as Record<PropertyKey, unknown>;
      const rawType = getRawActionType(action) as string;

      return {
        ...action,
        actionType: SELF_REVIEW_PROPOSAL_ACTION_TYPE_ALIASES[rawType] ?? rawType,
      };
    }),
  };
};
