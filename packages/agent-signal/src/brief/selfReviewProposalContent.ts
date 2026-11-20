/**
 * Full content of a nightly self-review proposal, for the "view details" view.
 *
 * `selfReviewBriefDetails` reduces each proposed action to a one-line row. Before
 * approving, a reader also needs what the action would actually write: the skill
 * body, the replacement system prompt, the memory text. The frozen proposal in
 * the brief metadata (`metadata.agentSignal.nightlySelfReview.selfReviewProposal`)
 * already carries each action's `operation.input`, so this module reads it
 * client-side without another request.
 */
import type { SelfReviewBriefDetailKind } from './selfReviewBriefDetails';

/** What one proposed action would write when the proposal is approved. */
export interface SelfReviewProposalContentItem {
  /** New skill body (create / refine / consolidate skill), as Markdown. */
  bodyMarkdown?: string;
  /** Skill description the action would set. */
  description?: string;
  /** What kind of change this action proposes. */
  kind: Exclude<SelfReviewBriefDetailKind, 'idea'>;
  /** Memory text a `write_memory` action would save. */
  memoryContent?: string;
  /** Stable skill name (slug) a `create_skill` action would reserve. */
  name?: string;
  /** Reviewer rationale for the change. */
  rationale?: string;
  /** Replacement agent system prompt of a `refine_prompt` action. */
  systemRole?: string;
  /** Existing target the action changes, e.g. the refined skill's title. */
  target?: string;
  /** Skill title the action would set. */
  title?: string;
}

const KNOWN_KINDS = new Set<SelfReviewProposalContentItem['kind']>([
  'consolidate_skill',
  'create_skill',
  'refine_prompt',
  'refine_skill',
  'write_memory',
]);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
};

const toContentItem = (value: unknown): SelfReviewProposalContentItem | undefined => {
  const action = asRecord(value);
  const actionType = pickString(action.actionType);
  if (!actionType || actionType === 'noop' || actionType === 'proposal_only') return;

  const kind = KNOWN_KINDS.has(actionType as SelfReviewProposalContentItem['kind'])
    ? (actionType as SelfReviewProposalContentItem['kind'])
    : 'other';
  const input = asRecord(asRecord(action.operation).input);
  const snapshot = asRecord(action.baseSnapshot);
  const target = asRecord(action.target);

  const fields: Omit<SelfReviewProposalContentItem, 'kind'> = {
    bodyMarkdown: pickString(input.bodyMarkdown),
    description: pickString(input.description),
    memoryContent: kind === 'write_memory' ? pickString(input.content) : undefined,
    name: kind === 'create_skill' ? pickString(input.name, target.skillName) : undefined,
    rationale: pickString(action.rationale),
    systemRole: pickString(input.systemRole),
    // A created skill has no existing target; its title/name describe it.
    target:
      kind === 'create_skill' || kind === 'write_memory'
        ? undefined
        : pickString(snapshot.targetTitle, target.skillName, snapshot.skillName),
    title: pickString(input.title),
  };

  const item: SelfReviewProposalContentItem = { kind };
  for (const [key, field] of Object.entries(fields) as [keyof typeof fields, string?][]) {
    if (field) item[key] = field;
  }

  return item;
};

/**
 * Reads what each proposed action of a nightly self-review brief would write.
 *
 * Use when:
 * - A card offers "view details" before the user approves a proposal
 *
 * Expects:
 * - `metadata` is the brief's raw `metadata` JSON (any shape is tolerated)
 *
 * Returns:
 * - One item per executable action, in proposal order; an empty array for
 *   ideas-only briefs, other briefs, or malformed metadata
 */
export const getSelfReviewProposalContent = (
  metadata: unknown,
): SelfReviewProposalContentItem[] => {
  const nightly = asRecord(asRecord(asRecord(metadata).agentSignal).nightlySelfReview);
  const actions = asRecord(nightly.selfReviewProposal).actions;
  if (!Array.isArray(actions)) return [];

  return actions.flatMap((action) => toContentItem(action) ?? []);
};

/**
 * Whether any item carries content worth opening a details view for: text the
 * one-line card rows cannot show in full.
 */
export const hasSelfReviewProposalContent = (items: SelfReviewProposalContentItem[]) =>
  items.some(
    (item) => item.bodyMarkdown || item.systemRole || item.memoryContent || item.description,
  );
