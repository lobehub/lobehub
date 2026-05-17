import { u } from 'unist-builder';
import { toXml } from 'xast-util-to-xml';
import { x } from 'xastscript';

export interface AgentSignalSelfIterationPromptInput {
  /** Stable agent id being reviewed. */
  agentId: string;
  /** Bounded self-iteration context serialized into the runtime prompt. */
  context: unknown;
  /** Runtime mode that controls review-specific policy text. */
  mode: 'feedback' | 'reflection' | 'review';
  /** Stable source id used for tracing and idempotency. */
  sourceId: string;
  /** Stable user id owning the reviewed agent. */
  userId: string;
  /** Evidence window exposed to tools and prompt renderers. */
  window: {
    /** Review or reflection window end ISO timestamp. */
    end: string;
    /** Optional user-local date for nightly review. */
    localDate?: string;
    /** Review or reflection window start ISO timestamp. */
    start: string;
    /** Optional IANA timezone for user-local windows. */
    timezone?: string;
  };
}

const SELF_ITERATION_SYSTEM_ROLE = [
  'You are the Agent Signal self-iteration agent.',
  'Inspect the bounded nightly review context and use the provided self-iteration tools to read evidence or apply safe write operations.',
  'Evidence ids and proposal keys are different namespaces: read topic/message/tool_call/agent_document evidence with getEvidenceDigest; read proposals with readSelfReviewProposal only when using proposalActivity.active[].proposalKey or keys returned from listSelfReviewProposals.',
  'Never claim that a write happened unless a write tool result confirms it.',
  'Use writeMemory only for user-level durable preferences that should survive across agents and topics, such as tone, reporting style, or verification expectations.',
  'Do not use writeMemory for reusable workflows, checklists, templates, skill drafts, agent capabilities, or agent/topic-scoped procedures. Route those to skill actions or recordSelfFeedbackIntent(kind="skill").',
  'Use createSkillIfAbsent when evidence describes a reusable workflow and you can provide a non-empty skill name and full bodyMarkdown. Treat agent_document evidence with hintIsSkill=true as strong skill evidence.',
  'When review evidence supports an approval-gated change, call createSelfReviewProposal in this run; do not offer to draft it later.',
  'For createSelfReviewProposal actions, use actionType exactly create_skill, refine_skill, consolidate_skill, or record_idea. For refine_skill include target.skillDocumentId and operation { domain: "skill", operation: "refine", input: { skillDocumentId, bodyMarkdown } }. For consolidate_skill include operation { domain: "skill", operation: "consolidate", input: { canonicalSkillDocumentId, sourceSkillIds, bodyMarkdown } }. Prefer recordSelfReviewIdea instead of proposal actions when the output is only a thought or question.',
  'Stop after the useful self-iteration work is complete and summarize the confirmed outcome.',
].join('\n');

/**
 * Builds the system role for Agent Signal self-iteration runtime calls.
 *
 * Use when:
 * - A server AgentRuntime call executes bounded self-iteration work
 * - Tests need the exact model-facing system role text
 *
 * Expects:
 * - Tool manifests are provided by the service layer
 *
 * Returns:
 * - Stable model-facing system instructions
 */
export const createAgentSignalSelfIterationSystemRole = () => SELF_ITERATION_SYSTEM_ROLE;

/**
 * Builds the tool manifest system role for Agent Signal self-iteration tools.
 *
 * Use when:
 * - Review mode needs proposal-specific read/write rules
 * - Reflection and intent modes need immediate feedback capture rules
 *
 * Expects:
 * - `mode` matches the runtime prompt mode
 *
 * Returns:
 * - Stable model-facing tool-use instructions
 */
export const createAgentSignalSelfIterationToolSystemRole = (
  mode: AgentSignalSelfIterationPromptInput['mode'],
) =>
  mode === 'review'
    ? 'Use resource read tools before writes when evidence is incomplete. Use getEvidenceDigest for topic/message/tool_call/agent_document evidenceRefs. Use readSelfReviewProposal only with proposal keys from proposalActivity.active or listSelfReviewProposals, never with evidence ids. Treat write tool results as the source of truth.'
    : 'Use resource read tools before writes when evidence is incomplete. Direct-apply only safe user-level memory or bounded skill updates. Prefer skill actions over memory when evidence includes reusable workflows, templates, checklists, or agent_document hintIsSkill=true. Record approval-gated or unsupported reflection output with recordSelfFeedbackIntent, and record non-actionable thoughts with recordReflectionIdea.';

const createNightlyReviewPromptXml = (input: AgentSignalSelfIterationPromptInput) =>
  toXml(
    u('root', [
      x(
        'self_iteration_review',
        {
          agent_id: input.agentId,
          review_window_end: input.window.end,
          review_window_start: input.window.start,
          source_id: input.sourceId,
          user_id: input.userId,
        },
        x(
          'review_objective',
          'Inspect this nightly review context and create a self-review proposal when the evidence supports an approval-gated change. Do not finish with only text when a proposal is required.',
        ),
        x(
          'review_policy_markdown',
          // NOTICE:
          // Keep this as a rule table, not a precomputed proposal payload.
          // Root cause summary: changing this to generic self-iteration wording made the local
          // E2E review source complete without producing the expected Daily Brief proposal.
          // Source/context: `devtools/agent-signal/self-iteration-e2e/run-local-e2e.ts`.
          // Removal condition: nightly self-review prompt/eval coverage proves generic wording
          // still produces equivalent proposal behavior.
          [
            'Use these deterministic self-review signal rules before deciding to finish without tools.',
            '',
            '| Signal kind | Required decision | Tool call | Notes |',
            '| --- | --- | --- | --- |',
            '| `skill_document_with_tool_failure` | Approval-gated skill refinement proposal | `createSelfReviewProposal` with one `refine_skill` action | Use the matching `managedSkills[].documentId` or `documentActivity.skillBucket[].agentDocumentId` as `target.skillDocumentId`; include `operation: { domain: "skill", operation: "refine", input: { skillDocumentId, bodyMarkdown } }`; cite topic/message/agent_document evidence refs. |',
            '| `repeated_tool_failure` involving `replaceSkillContentCAS` | Do not retry the write directly during nightly review | `createSelfReviewProposal` when the failed args contain a corrected skill body or a clear skill target | Prefer the failed tool args as the proposed body; call `getEvidenceDigest` first if the body or target is not visible in context. |',
            '| `skill_documents_maybe_overlap` | Consolidation candidate | `createSelfReviewProposal` with `consolidate_skill` only when there is a canonical skill and explicit source skills | Otherwise record no proposal for this signal alone. |',
            '',
            'If a rule says `createSelfReviewProposal`, do not stop with only explanatory text. If required fields are missing, use read tools once to gather them; only skip when evidence remains insufficient after reading.',
          ].join('\n'),
        ),
        x('review_window', `Review window: ${input.window.start} to ${input.window.end}`),
        x('nightly_review_context_json', JSON.stringify(input.context)),
      ),
    ]),
  );

/**
 * Builds the user prompt for Agent Signal self-iteration runtime calls.
 *
 * Use when:
 * - The self-iteration service needs review, reflection, or intent runtime prompts
 * - Tests need stable rendered prompt snapshots
 *
 * Expects:
 * - Context has already been collected and bounded by the service layer
 *
 * Returns:
 * - Stable model-facing user prompt text
 */
export const createAgentSignalSelfIterationPrompt = (
  input: AgentSignalSelfIterationPromptInput,
) => {
  if (input.mode === 'review') return createNightlyReviewPromptXml(input);

  return [
    `Agent id: ${input.agentId}`,
    `User id: ${input.userId}`,
    `Source id: ${input.sourceId}`,
    `Mode: ${input.mode}`,
    `Evidence window: ${input.window.start} to ${input.window.end}`,
    'Self-iteration context JSON:',
    JSON.stringify(input.context),
  ].join('\n');
};
