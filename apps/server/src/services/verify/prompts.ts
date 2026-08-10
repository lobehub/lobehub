import type { VerifyCheckItem, VerifyEvidenceType } from '@lobechat/types';

/** Bump when the plan-gen prompt meaningfully changes (tracing partition key). */
export const VERIFY_PLAN_PROMPT_VERSION = '3';
/** Bump when the judge prompt meaningfully changes. */
export const VERIFY_JUDGE_PROMPT_VERSION = '2';
/** Bump when the report prompt meaningfully changes. */
export const VERIFY_REPORT_PROMPT_VERSION = '1';

export interface PlanPromptInput {
  /** Optional run context (agent role, repo, constraints). */
  context?: string;
  /** Already-mounted criteria titles, so the AI proposes complementary ones. */
  existingTitles?: string[];
  goal: string;
  maxCriteria: number;
}

export const buildPlanPrompt = ({
  goal,
  context,
  existingTitles,
  maxCriteria,
}: PlanPromptInput) => {
  const system = [
    'You are a delivery checker planner for an autonomous agent run.',
    'Given the run goal, propose a concise set of verification criteria — each a single pass/fail standard that determines whether the delivered work satisfies the user’s explicit requirements.',
    'Guidelines:',
    `- Propose at most ${maxCriteria} criteria. Fewer, sharper criteria are better than many vague ones.`,
    '- Every criterion must be an outcome the USER can judge — what the delivery does, shows, or produces. Never propose the repo’s own programmatic gates as criteria: unit / integration / regression tests, test suites, coverage, type-checks, lint, or a clean build. Those are preconditions of shipping, not acceptance items, and they are dropped before the acceptance page renders.',
    '- First enumerate every deliverable and artifact needed to prove the criterion. Put each one in requiredEvidence with its type, semantic modality, source scope, and a concrete capture hint. Use [] only when the final text answer alone is sufficient.',
    '- requiredEvidence types: screenshot / gif / video for what the user sees, audio for a delivered sound (TTS output, a voice reply, an alert tone), text / markdown / dom_snapshot / transcript otherwise. A deliverable the user listens to needs audio evidence — describing it in prose does not prove it.',
    '- Choose verifierType: "llm" only when all required evidence is inline text, or a single image modality that a multimodal judge can directly inspect. Choose "agent" whenever evidence spans multiple modalities/files, requires opening a document or attachment, exceeds a normal prompt, or needs active investigation. Choose "program" only for strictly deterministic command checks.',
    '- Set required=true when failing the criterion must block delivery; false for nice-to-have improvements.',
    '- Set onFail="auto_repair" when a failure can be fixed by re-running the agent with guidance; otherwise "manual".',
    '- description: a one-sentence summary of what this criterion verifies.',
    '- instruction: a detailed, fine-grained judging rubric for this criterion — the exact conditions that constitute a pass, what counts as a fail, the concrete evidence to look for, and edge cases to check. Be specific and thorough, not a one-liner.',
    '- Do not restate criteria already mounted (listed below); propose complementary ones only.',
  ].join('\n');

  const user = [
    `## Run goal\n${goal}`,
    context ? `\n## Context\n${context}` : '',
    existingTitles?.length
      ? `\n## Already-mounted criteria (do not duplicate)\n${existingTitles.map((t) => `- ${t}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
};

/** One captured artifact, summarized for the judge. */
export interface JudgeEvidence {
  /** Resolved, model-readable URL for supported inline media. */
  accessUrl?: string;
  content?: string | null;
  description?: string | null;
  /**
   * Stored artifact id (screenshot / video / large text). Inline judges must
   * load supported files into the actual model message; agent verifiers attach
   * every file to their isolated run.
   */
  fileId?: string | null;
  type: VerifyEvidenceType;
}

export interface JudgePromptInput {
  /** The artifacts / agent output to judge against. */
  deliverable: string;
  goal: string;
  /** Each item carries its resolved judging instruction + any captured evidence. */
  items: (Pick<VerifyCheckItem, 'id' | 'title'> & {
    evidence?: JudgeEvidence[];
    instruction?: string;
  })[];
  /** Single mode judges one item; batch mode judges all `items`. */
  mode: 'single' | 'batch';
}

export const describeEvidence = (evidence: JudgeEvidence[] | undefined): string => {
  if (!evidence?.length) return '';
  const lines = evidence.map((e) => {
    const caption = e.description ? ` — ${e.description}` : '';
    const payload = e.content
      ? `: ${e.content}`
      : e.fileId
        ? ' [artifact attached to this judge request]'
        : ' [artifact metadata only; contents unavailable]';
    return `  - (${e.type})${caption}${payload}`;
  });
  return `\nEvidence captured during the run:\n${lines.join('\n')}`;
};

const describeItem = (item: JudgePromptInput['items'][number]) => {
  const instruction = item.instruction ? `\n${item.instruction}` : '';
  return `${item.title}${instruction}${describeEvidence(item.evidence)}`;
};

export const buildJudgePrompt = ({ goal, deliverable, items, mode }: JudgePromptInput) => {
  const system = [
    'You are a rigorous delivery checker. Judge whether the deliverable satisfies each criterion using the Toulmin argument model.',
    'For every criterion output:',
    '- verdict: "passed" | "failed" | "uncertain" (the Claim).',
    '- confidence: 0..1 (the Qualifier).',
    '- evidence: the concrete data from the deliverable supporting your claim (the Data).',
    '- reasoning: why that evidence supports the verdict (the Warrant).',
    '- counterEvidence: evidence pointing the other way, if any (the Rebuttal).',
    '- limitation: what you could not verify and why (the Rebuttal).',
    '- suggestion: a concrete fix when the verdict is failed/uncertain.',
    'Artifacts listed under "Evidence captured during the run" are primary Data only when their contents are attached or quoted. Never treat mere existence, a filename, or a caption as proof of what an artifact depicts.',
    'Be skeptical: default to "uncertain" rather than "passed" when evidence is missing.',
    mode === 'batch'
      ? 'Return one verdict object per criterion, each tagged with its exact checkItemId.'
      : 'Return a single verdict object for the one criterion below.',
  ].join('\n');

  const criteriaBlock =
    mode === 'batch'
      ? items.map((i) => `- [${i.id}] ${describeItem(i)}`).join('\n')
      : describeItem(items[0]);

  const user = [
    `## Run goal\n${goal}`,
    `\n## Criteria\n${criteriaBlock}`,
    `\n## Deliverable\n${deliverable}`,
  ].join('\n');

  return { system, user };
};

export interface ReportPromptItem {
  confidence?: number | null;
  evidence?: JudgeEvidence[];
  reasoning?: string | null;
  status: string;
  suggestion?: string | null;
  title?: string | null;
  verdict?: string | null;
}

export interface ReportPromptInput {
  deliverable: string;
  goal: string;
  items: ReportPromptItem[];
  /** Pre-computed rollup so the narrative never contradicts the numbers. */
  stats: { failed: number; passed: number; total: number; uncertain: number };
  verdict: string;
}

/**
 * Narrative-only report prompt: the verdict + statistics are computed upstream
 * and handed in, so the LLM writes prose around fixed numbers rather than
 * re-deriving (and possibly contradicting) them.
 */
export const buildReportPrompt = ({
  goal,
  deliverable,
  items,
  stats,
  verdict,
}: ReportPromptInput) => {
  const system = [
    'You are writing a delivery-verification report for the user who owns this task.',
    'The overall verdict and the pass/fail/uncertain counts are already decided and given to you — never contradict or recompute them.',
    'Write in the language of the run goal.',
    'Produce two fields:',
    '- summary: 3-5 sentences for a chat notification — the verdict, what was checked, and the single most important finding.',
    '- content: a full Markdown report. Use a per-criterion section with its verdict, the reasoning, the evidence that backs it, and a concrete next step for anything failed or uncertain. Reference captured artifacts where they support a claim.',
    'Be specific and evidence-grounded; do not invent results that are not listed below.',
  ].join('\n');

  const itemBlock = items
    .map((i) => {
      const head = `### ${i.title ?? 'Criterion'} — ${i.verdict ?? i.status}${
        typeof i.confidence === 'number' ? ` (confidence ${i.confidence})` : ''
      }`;
      const reasoning = i.reasoning ? `\nReasoning: ${i.reasoning}` : '';
      const suggestion = i.suggestion ? `\nSuggestion: ${i.suggestion}` : '';
      return `${head}${reasoning}${suggestion}${describeEvidence(i.evidence)}`;
    })
    .join('\n\n');

  const user = [
    `## Run goal\n${goal}`,
    `\n## Overall verdict\n${verdict} — ${stats.passed}/${stats.total} passed, ${stats.failed} failed, ${stats.uncertain} uncertain`,
    `\n## Per-criterion results\n${itemBlock}`,
    `\n## Deliverable\n${deliverable}`,
  ].join('\n');

  return { system, user };
};
