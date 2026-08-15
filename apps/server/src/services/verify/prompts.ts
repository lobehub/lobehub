import type { VerifyCheckItem, VerifyEvidenceType } from '@lobechat/types';

/** Bump when the plan-gen prompt meaningfully changes (tracing partition key). */
export const VERIFY_PLAN_PROMPT_VERSION = '3';
/** Bump when the judge prompt meaningfully changes. */
export const VERIFY_JUDGE_PROMPT_VERSION = '2';
/** Bump when the report prompt meaningfully changes. */
export const VERIFY_REPORT_PROMPT_VERSION = '1';
/**
 * Bump when the review-prediction prompt meaningfully changes. Doubles as part
 * of the uniqueness key on `verify_review_predictions`, so a bump makes the next
 * run write a NEW opinion instead of overwriting the old one — which is what
 * keeps two prompt versions comparable on the same checks.
 */
export const REVIEW_PREDICT_PROMPT_VERSION = '1';

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

// ============================================
// Review prediction — a second opinion on a check the verifier already judged
// ============================================

export interface ReviewPredictPromptInput {
  /** The check's detailed rule body, when the criterion has one. */
  instruction?: string;
  /** The acceptance's one-sentence requirement — the scope test for `new-idea`. */
  requirement?: string;
  /** Where the check was exercised (`web` / `desktop` / …). */
  surface?: string;
  /** The check being re-judged. */
  title: string;
  /** The verifier's own reasoning, so the reviewer can attack it rather than repeat it. */
  toulmin?: { evidence?: string; reasoning?: string };
  /** The verifier's claim. Almost always `passed` — that is the point. */
  verdict?: string;
  /** Captions for the attached artifacts, indexed to match the image order. */
  visuals: string[];
}

/**
 * The offline baseline (187 real samples across kimi-k3,
 * gemini-3.6-flash and gemini-3.1-pro) shaped every rule below. Two findings did
 * most of the shaping:
 *
 *  1. The models perceived defects correctly and then FORGAVE them — "仅约 17px
 *     的轻微右偏,在可接受容差内" against a human "这个不在图片中间哎". Adding an
 *     explicit zero-tolerance rule recovered every one of those. Hence the
 *     hard ban on hedging vocabulary rather than a polite "be strict".
 *  2. Of the checks all three models let through, roughly three quarters were
 *     cases where the human was answering a different question — proposing new
 *     design, or objecting that the evidence was insufficient. Those are NOT
 *     this prompt's job (the UI routes them to their own intents), so the rules
 *     below deliberately scope the model to "does the evidence show THIS check
 *     satisfied" and tell it to pass anything it cannot judge from the frame.
 */
export const buildReviewPredictPrompt = (input: ReviewPredictPromptInput) => {
  const system = [
    'You audit whether a delivery really satisfies ONE acceptance check, by looking at the screenshots captured during verification.',
    '',
    'An automated verifier already judged this check. It is systematically too lenient — in production it wrongly passed 40x more often than it wrongly failed. Your job is to independently re-judge, not to restate its conclusion.',
    '',
    '## Tolerance is zero',
    'When the check names a number (20px), a position (centered), an alignment (same height), or a width (full-bleed), any visible deviation is a reject.',
    'Never write "roughly matches", "approximately centered", "within acceptable tolerance", or "slight deviation" as a reason to pass — if you are reaching for that phrasing, the check did not pass.',
    'If your own reasoning describes an offset, a size difference, a misalignment or uneven spacing, that IS the reject. Do not then argue it away.',
    '"Looks about right" is not a pass. Being unable to see any difference is.',
    '',
    '## Stay inside this check',
    'Judge only the check quoted below. A delivery you find ugly, over-complicated, or designed differently than you would have designed it still PASSES if it does what the check asks — taste is not your call here.',
    'Do not reject for something the check does not ask for, however reasonable that request would be.',
    '',
    '## Only what the frame shows',
    'Judge from what is visible in the attached images. Scroll behaviour, hover states, navigation results and anything that needs a second moment in time cannot be judged from a still — if the check depends on one of those, accept and say the frame cannot show it.',
    'Missing evidence is not a reject. It is the one case where you accept despite being unsure, and lower confidence to say so.',
    '',
    '## When you reject',
    'Circle the exact region at fault using coordinates normalized 0-1 against the WHOLE image (x/y = top-left corner), and name the problem in that region.',
    'Write `comment` as one sentence a developer can act on. State what is wrong and where — not "the layout has issues".',
    '',
    'Answer in the language the check is written in. Set confidence honestly: it is read as a number, not as reassurance.',
  ].join('\n');

  const visualBlock = input.visuals.length
    ? input.visuals
        .map((caption, index) => `  [image ${index}] ${caption || '(untitled)'}`)
        .join('\n')
    : '  (none)';

  const user = [
    `## The check\n${input.title}`,
    input.instruction ? `\n### How it should be judged\n${input.instruction}` : '',
    input.requirement ? `\n## What this delivery as a whole promised\n${input.requirement}` : '',
    input.surface ? `\nSurface under test: ${input.surface}` : '',
    input.verdict ? `\n## The automated verifier said: ${input.verdict}` : '',
    input.toulmin?.reasoning ? `Its reasoning: ${input.toulmin.reasoning}` : '',
    input.toulmin?.evidence ? `What it cited: ${input.toulmin.evidence}` : '',
    `\n## Attached evidence\n${visualBlock}`,
    '\nRe-judge the check against these images.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
};
