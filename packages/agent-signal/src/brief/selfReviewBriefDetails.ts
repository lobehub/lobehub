/**
 * Display model for Agent Signal nightly self-review Daily Briefs.
 *
 * The persisted brief metadata (`metadata.agentSignal.nightlySelfReview`) already
 * holds the frozen proposal actions and ideas. This module reads that payload
 * into a small, locale-free display model and formats it with a caller-supplied
 * translator, so the server (persisted brief text) and the client (home card)
 * describe the same proposal with the same words.
 */

/** Kind of change one detail row describes. */
export type SelfReviewBriefDetailKind =
  | 'consolidate_skill'
  | 'create_skill'
  | 'idea'
  | 'other'
  | 'refine_prompt'
  | 'refine_skill'
  | 'write_memory';

/** One proposed action or recorded idea, reduced to what a reader needs. */
export interface SelfReviewBriefDetailItem {
  /** One-line explanation: the rationale, or the skill description when no rationale exists. */
  description?: string;
  /** What kind of change this row proposes. */
  kind: SelfReviewBriefDetailKind;
  /** Human-readable target: skill title/name, memory text, or idea title. */
  target?: string;
}

/** Locale-free display model of one nightly self-review brief. */
export interface SelfReviewBriefDetails {
  /** Proposed actions or recorded ideas, in proposal order. */
  items: SelfReviewBriefDetailItem[];
  /** Whether the brief asks for a decision or only records ideas. */
  kind: 'ideas' | 'proposal';
  /** Reviewer-written proposal summary, when one was stored. */
  summary?: string;
}

/** Translator resolving `home` namespace keys with string interpolation. */
export type SelfReviewBriefDetailsTranslator = (
  key: string,
  options?: Record<string, string>,
) => string;

const KEY_PREFIX = 'brief.agentSignal.selfReview';

/** Longest target shown inside a title before it is cut with an ellipsis. */
export const SELF_REVIEW_TITLE_TARGET_MAX_LENGTH = 60;
/** Longest one-line description kept in persisted brief text. */
export const SELF_REVIEW_DESCRIPTION_MAX_LENGTH = 160;
/** Rows listed in persisted brief text before the rest collapse into "+N more". */
export const SELF_REVIEW_LIST_MAX_ITEMS = 5;

const KNOWN_KINDS = new Set<SelfReviewBriefDetailKind>([
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

/**
 * Collapses whitespace to a single line and cuts it to `maxLength` characters.
 *
 * Use when:
 * - Model-written text (rationale, memory content) is shown in a one-line slot
 *
 * Returns:
 * - The trimmed single-line text, ending in `…` when it was cut
 */
export const toSelfReviewOneLine = (text: string, maxLength: number) => {
  const line = text.replaceAll(/\s+/g, ' ').trim();
  const chars = [...line];

  return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : line;
};

const getActionTarget = (kind: SelfReviewBriefDetailKind, action: Record<string, unknown>) => {
  const target = asRecord(action.target);
  const snapshot = asRecord(action.baseSnapshot);
  const input = asRecord(asRecord(action.operation).input);

  switch (kind) {
    case 'create_skill': {
      return pickString(input.title, input.name, target.skillName, snapshot.skillName);
    }
    case 'refine_skill':
    case 'consolidate_skill': {
      return pickString(snapshot.targetTitle, target.skillName, input.title, snapshot.skillName);
    }
    case 'write_memory': {
      return pickString(input.content);
    }
    case 'refine_prompt': {
      return;
    }
    default: {
      return pickString(snapshot.targetTitle, target.skillName, input.title, input.name);
    }
  }
};

const toActionItem = (value: unknown): SelfReviewBriefDetailItem | undefined => {
  const action = asRecord(value);
  const actionType = pickString(action.actionType);
  if (!actionType || actionType === 'noop' || actionType === 'proposal_only') return;

  const kind = KNOWN_KINDS.has(actionType as SelfReviewBriefDetailKind)
    ? (actionType as SelfReviewBriefDetailKind)
    : 'other';
  const target = getActionTarget(kind, action);
  const description = pickString(
    action.rationale,
    asRecord(asRecord(action.operation).input).description,
  );

  return {
    ...(description ? { description } : {}),
    kind,
    ...(target ? { target } : {}),
  };
};

const toIdeaItem = (value: unknown): SelfReviewBriefDetailItem | undefined => {
  const idea = asRecord(value);
  const target = pickString(idea.title, asRecord(idea.target).skillName);
  const description = pickString(idea.rationale);
  if (!target && !description) return;

  return {
    ...(description ? { description } : {}),
    kind: 'idea',
    ...(target ? { target } : {}),
  };
};

/**
 * Reads the nightly self-review display model from Daily Brief metadata.
 *
 * Use when:
 * - The server projects persisted title/summary text for a nightly review brief
 * - A client card renders proposal details inline, including briefs stored
 *   before the persisted text named the change
 *
 * Expects:
 * - `metadata` is the brief's raw `metadata` JSON (any shape is tolerated)
 *
 * Returns:
 * - The display model for proposal or ideas briefs, or `undefined` when the
 *   metadata carries no proposal actions or ideas to describe
 */
export const getSelfReviewBriefDetails = (
  metadata: unknown,
): SelfReviewBriefDetails | undefined => {
  const nightly = asRecord(asRecord(asRecord(metadata).agentSignal).nightlySelfReview);
  const proposal = asRecord(nightly.selfReviewProposal);

  if (Array.isArray(proposal.actions)) {
    const items = proposal.actions.flatMap((action) => toActionItem(action) ?? []);
    const summary = pickString(proposal.summary);

    if (items.length > 0) return { items, kind: 'proposal', ...(summary ? { summary } : {}) };
  }

  if (nightly.outcome === 'ideas' && Array.isArray(nightly.ideas)) {
    const items = nightly.ideas.flatMap((idea) => toIdeaItem(idea) ?? []);

    if (items.length > 0) return { items, kind: 'ideas' };
  }
};

/**
 * Formats the short kind label of one row, e.g. `New skill`.
 */
export const formatSelfReviewKindLabel = (
  kind: SelfReviewBriefDetailKind,
  t: SelfReviewBriefDetailsTranslator,
) => t(`${KEY_PREFIX}.kind.${kind}.plain`);

/**
 * Formats one row as a headline naming its target, e.g. `New skill: PR checklist`.
 */
export const formatSelfReviewItemHeadline = (
  item: SelfReviewBriefDetailItem,
  t: SelfReviewBriefDetailsTranslator,
) => {
  // An idea without a title still has something to say; its rationale is the headline.
  const target = item.target ?? (item.kind === 'idea' ? item.description : undefined);

  return target && item.kind !== 'refine_prompt'
    ? t(`${KEY_PREFIX}.kind.${item.kind}.withTarget`, {
        target: toSelfReviewOneLine(target, SELF_REVIEW_TITLE_TARGET_MAX_LENGTH),
      })
    : formatSelfReviewKindLabel(item.kind, t);
};

/**
 * Formats a brief title that names the main proposed change or idea.
 *
 * Returns:
 * - `New skill: PR checklist`, or `New skill: PR checklist (+2 more)` when the
 *   brief carries several rows
 */
export const formatSelfReviewBriefTitle = (
  details: SelfReviewBriefDetails,
  t: SelfReviewBriefDetailsTranslator,
) => {
  const items = details.items ?? [];
  const headline = formatSelfReviewItemHeadline(items[0], t);
  const rest = items.length - 1;

  return rest > 0
    ? t(`${KEY_PREFIX}.title.more`, { count: String(rest), title: headline })
    : headline;
};

/**
 * Picks the one- or two-line lead under the title: the proposal summary, else
 * the first row's rationale.
 */
export const getSelfReviewBriefLead = (details: SelfReviewBriefDetails) => {
  if (details.summary) return details.summary;
  const items = details.items ?? [];
  if (items.length !== 1) return;

  const [item] = items;
  // A titleless idea already used its rationale as the headline.
  if (item.kind === 'idea' && !item.target) return;

  return item.description;
};

/**
 * Formats the persisted Markdown summary for a nightly self-review brief.
 *
 * Use when:
 * - The server persists brief text read by surfaces that only render `summary`
 *   (news list, notifications, brief tools)
 *
 * Returns:
 * - The lead line, followed by a bounded bullet list when there are several rows
 */
export const formatSelfReviewBriefSummary = (
  details: SelfReviewBriefDetails,
  t: SelfReviewBriefDetailsTranslator,
) => {
  const lead = getSelfReviewBriefLead(details);
  const parts = lead ? [toSelfReviewOneLine(lead, SELF_REVIEW_DESCRIPTION_MAX_LENGTH)] : [];

  const items = details.items ?? [];
  if (items.length > 1) {
    const shown = items.slice(0, SELF_REVIEW_LIST_MAX_ITEMS);
    const lines = shown.map((item) => {
      const headline = formatSelfReviewItemHeadline(item, t);
      const description =
        item.description && !(item.kind === 'idea' && !item.target)
          ? ` — ${toSelfReviewOneLine(item.description, SELF_REVIEW_DESCRIPTION_MAX_LENGTH)}`
          : '';

      return `- **${headline}**${description}`;
    });
    const hidden = items.length - shown.length;
    if (hidden > 0) lines.push(`- ${t(`${KEY_PREFIX}.list.more`, { count: String(hidden) })}`);

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
};
