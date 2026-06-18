import type { VerifyCheckItem } from '@lobechat/types';

/** Bump when the plan-gen prompt meaningfully changes (tracing partition key). */
export const VERIFY_PLAN_PROMPT_VERSION = '1';
/** Bump when the judge prompt meaningfully changes. */
export const VERIFY_JUDGE_PROMPT_VERSION = '1';

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
    '- Choose verifierType: "llm" for qualitative judgment from artifacts/output; "agent" when active investigation (reading files, running checks) is needed; "program" only for strictly deterministic command checks.',
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

export interface JudgePromptInput {
  /** The artifacts / agent output to judge against. */
  deliverable: string;
  goal: string;
  /** Each item carries its resolved judging instruction (from its document, if any). */
  items: (Pick<VerifyCheckItem, 'id' | 'title'> & { instruction?: string })[];
  /** Single mode judges one item; batch mode judges all `items`. */
  mode: 'single' | 'batch';
}

const describeItem = (item: JudgePromptInput['items'][number]) => {
  const instruction = item.instruction ? `\n${item.instruction}` : '';
  return `${item.title}${instruction}`;
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
