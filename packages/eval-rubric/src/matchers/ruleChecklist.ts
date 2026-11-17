import type { EvalBenchmarkRubric, EvalRuleVerdict, RubricConfigLLM } from '@lobechat/types';

import { judgeErrorResult } from './judgeError';
import type { MatchContext, MatchResult } from './types';

/**
 * Rule checklist.
 *
 * The criteria are a list of `Must:` / `Must not:` rules and the judge decides
 * every rule on its own instead of blending them into one score. The case
 * passes only when every rule is satisfied; the score is the share of rules
 * satisfied, kept for ranking and diagnosis. There is no threshold: a 0.9 is a
 * failed case with one rule missed, not a pass.
 */

const DEFAULT_SYSTEM_ROLE = [
  'You are a strict auditor. An AI agent attempted a task; grade the attempt against a checklist of rules, one rule at a time.',
  '',
  'Base every verdict on what the [Output] says and on what the [Evidence] shows the agent actually did. A claim in the output that the evidence does not support is not satisfied. Do not solve the task yourself and do not reward effort.',
  '',
  'Verdicts:',
  '- "satisfied": the output or the evidence shows the rule was met.',
  '- "violated": the output or the evidence shows the rule was broken, or a "Must" rule was not done.',
  '- "unverifiable": the materials show neither. Use it only when nothing in the output or the evidence bears on the rule; when they show the rule met or broken, say so.',
  'A "Must not" rule is satisfied when nothing in the output or the evidence breaks it.',
  'A tool call that failed and had no effect does not count as doing the action: judge rules about how many times something was done by the calls that succeeded.',
  '',
  'How to read the evidence:',
  '- A result that says "success" is not proof the change took effect. Check that it names the record, field and value the rule is about; a result showing another field or no change means the action was not done.',
  '- Figures, names and facts the output presents as found (market sizes, rates, prices, IDs, quotes) must appear in a tool result. A figure credited to a source whose result failed, was empty or was never read is not supported.',
  '- When a rule names a number (exactly three links, five items, one event), count them in the output or the evidence before deciding, and give the count in the reason.',
  '- Time and schedule rules: work out what the call actually does (for example the times a cron pattern fires) rather than trusting the description the agent wrote.',
  '- Write the reason first, then make the verdict match it. A reason that says the rule was met with a "violated" verdict, or the other way round, is wrong.',
  '',
  'A [Reference], when given, describes one acceptable way to handle the task. Use it only to understand what the rules mean; it is not a rule. Never mark a rule violated because the attempt differs from the reference.',
  '',
  'Respond with a JSON object: {"rules": [{"index": <rule number>, "verdict": "satisfied" | "violated" | "unverifiable", "reason": "<one sentence>"}, ...], "summary": "<one sentence on the attempt>"}. Include every rule exactly once.',
].join('\n');

const VERDICTS = ['satisfied', 'violated', 'unverifiable'] as const;

/**
 * The judge answer for `count` rules: one verdict per rule, numbered 1 to
 * `count`. The bounds also steer judges that do not enforce the schema.
 */
const checklistSchema = (count: number): Record<string, unknown> => ({
  additionalProperties: false,
  properties: {
    rules: {
      description: `Exactly ${count} verdict${count === 1 ? '' : 's'}, one per rule`,
      items: {
        additionalProperties: false,
        properties: {
          index: {
            description: `The rule number, from 1 to ${count}`,
            maximum: count,
            minimum: 1,
            type: 'integer',
          },
          reason: { description: 'One sentence grounding the verdict', type: 'string' },
          verdict: { enum: VERDICTS, type: 'string' },
        },
        required: ['index', 'verdict', 'reason'],
        type: 'object',
      },
      maxItems: count,
      minItems: count,
      type: 'array',
    },
    summary: { description: 'One sentence on the attempt as a whole', type: 'string' },
  },
  required: ['rules', 'summary'],
  type: 'object',
});

export interface ChecklistRule {
  kind: 'must' | 'must-not' | 'rule';
  text: string;
}

const RULE_LINE = /^\s*(?:[-*•]\s*|\d+[.)]\s*)?(must\s+not|must)\s*[:：](.*)$/i;

/**
 * Splits the criteria into rules: one per `Must:` / `Must not:` line, with
 * following plain lines appended to the rule above them. Criteria without
 * such lines are one rule.
 */
export const parseChecklistRules = (criteria: string): ChecklistRule[] => {
  const rules: ChecklistRule[] = [];
  for (const raw of criteria.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const matched = RULE_LINE.exec(line);
    if (matched) {
      rules.push({
        kind: /not$/i.test(matched[1].replaceAll(/\s+/g, '')) ? 'must-not' : 'must',
        text: matched[2].trim(),
      });
    } else if (rules.length > 0) {
      rules.at(-1)!.text += ` ${line}`;
    }
  }
  return rules.length > 0 ? rules : [{ kind: 'rule', text: criteria.trim() }];
};

const ruleLabel = (rule: ChecklistRule) =>
  rule.kind === 'must'
    ? `Must: ${rule.text}`
    : rule.kind === 'must-not'
      ? `Must not: ${rule.text}`
      : rule.text;

const MARK: Record<EvalRuleVerdict['verdict'], string> = {
  satisfied: '✓',
  unverifiable: '?',
  violated: '✗',
};

function buildUserPrompt(
  rules: ChecklistRule[],
  actual: string,
  expected: string | undefined,
  input: string | undefined,
  evidence: string | undefined,
): string {
  const parts = [`[Rules]\n${rules.map((rule, i) => `${i + 1}. ${ruleLabel(rule)}`).join('\n')}`];
  if (input) parts.push(`[Input]\n${input}`);
  parts.push(`[Output]\n${actual}`);
  if (evidence) {
    parts.push(
      `[Evidence]\nWhat the agent did while producing the output: its tool calls in order, with results, and the state it left behind. Rules about actions or resulting state are decided from here, not from what the output claims.\n${evidence}`,
    );
  }
  // Graded only through the rules: shown as context, never as one more requirement.
  if (expected) parts.push(`[Reference]\n${expected}`);
  return parts.join('\n\n');
}

interface JudgeRuleRow {
  index?: unknown;
  reason?: unknown;
  verdict?: unknown;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Require exactly one explicit verdict for every one-based rule in the schema;
 * otherwise say what is wrong, so a retry can be told.
 */
const readVerdicts = (
  rules: ChecklistRule[],
  rows: unknown[],
): { problem: string } | { verdicts: EvalRuleVerdict[] } => {
  if (rows.length !== rules.length)
    return {
      problem: `had ${plural(rows.length, 'verdict')} for ${plural(rules.length, 'rule')}`,
    };
  const byIndex = new Map<number, EvalRuleVerdict>();
  for (const value of rows) {
    const row = value as JudgeRuleRow | null | undefined;
    const index = row?.index;
    const verdict = VERDICTS.find((item) => item === row?.verdict);
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > rules.length)
      return { problem: `numbered a verdict ${String(index)}, outside 1 to ${rules.length}` };
    if (byIndex.has(index)) return { problem: `gave rule ${index} more than one verdict` };
    if (!verdict || typeof row?.reason !== 'string')
      return { problem: `gave rule ${index} no valid verdict and reason` };
    // A rule that is not met has to say why: the failure is read from this reason.
    if (verdict !== 'satisfied' && !row.reason.trim())
      return { problem: `gave rule ${index} a "${verdict}" verdict with an empty reason` };
    byIndex.set(index, {
      ...(row.reason && { reason: row.reason }),
      rule: ruleLabel(rules[index - 1]),
      verdict,
    });
  }
  return { verdicts: rules.map((_, position) => byIndex.get(position + 1)!) };
};

/** Asks for exactly one verdict per rule; after an unusable answer, also says what was wrong. */
const answerInstruction = (count: number, problem?: string) =>
  [
    ...(problem
      ? [
          `[Correction]\nYour previous answer ${problem}, so it could not be used. Answer again from the same materials.`,
        ]
      : []),
    `[Answer]\nThere ${count === 1 ? 'is' : 'are'} ${plural(count, 'rule')}. Return exactly ${plural(count, 'verdict')}, numbered 1 to ${count}, one per rule as listed: never split a rule into several verdicts or merge rules. Return only valid JSON matching the schema.`,
  ].join('\n\n');

export interface MatchRuleChecklistParams {
  actual: string;
  context?: MatchContext;
  expected?: string;
  input?: string;
  rubric: EvalBenchmarkRubric;
}

export const matchRuleChecklist = async ({
  actual,
  context,
  expected,
  input,
  rubric,
}: MatchRuleChecklistParams): Promise<MatchResult> => {
  if (!context?.generateObject) {
    return { ...judgeErrorResult('LLM judge not available'), gating: true };
  }

  const cfg = (rubric.config ?? {}) as RubricConfigLLM;
  if (cfg.criteria !== undefined && typeof cfg.criteria !== 'string') {
    return { ...judgeErrorResult('Invalid judge criteria'), gating: true };
  }
  const model = cfg.model || context.judgeModel;
  if (typeof model !== 'string' || !model.trim()) {
    return { ...judgeErrorResult('No judge model configured'), gating: true };
  }

  const rules = parseChecklistRules(cfg.criteria || 'The output completes the task correctly.');
  if (rules.some((rule) => !rule.text)) {
    return { ...judgeErrorResult('No checklist rules configured'), gating: true };
  }
  const userPrompt = buildUserPrompt(rules, actual, expected, input, context.judgeEvidence);
  const schema = checklistSchema(rules.length);
  const maxAttempts = Math.max(1, context.judgeMaxAttempts ?? 3);

  let lastResult: MatchResult = {
    ...judgeErrorResult('LLM judge did not return rule verdicts'),
    gating: true,
  };
  // Why the previous answer was unusable: the retry says so instead of asking
  // the same question again and getting the same mistake back.
  let problem: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await context.generateObject({
        messages: [
          { content: cfg.systemRole || DEFAULT_SYSTEM_ROLE, role: 'system' as const },
          {
            content: `${userPrompt}\n\n${answerInstruction(rules.length, problem)}`,
            role: 'user' as const,
          },
        ],
        model,
        provider: cfg.provider,
        schema,
      });
      const read = Array.isArray(result?.rules)
        ? readVerdicts(rules, result.rules)
        : { problem: 'had no list of rule verdicts' };
      if ('problem' in read || typeof result?.summary !== 'string') {
        problem = 'problem' in read ? read.problem : 'had no summary';
        lastResult = {
          ...judgeErrorResult(`LLM judge did not return rule verdicts: its answer ${problem}`),
          gating: true,
        };
        continue;
      }
      const { verdicts } = read;

      const satisfied = verdicts.filter((item) => item.verdict === 'satisfied').length;
      const summary = typeof result.summary === 'string' ? result.summary.trim() : '';
      const lines = verdicts.map(
        (item, i) =>
          `${i + 1}. ${MARK[item.verdict]} ${item.rule}${
            item.verdict === 'satisfied' || !item.reason ? '' : ` — ${item.reason}`
          }`,
      );

      return {
        gating: true,
        passed: satisfied === verdicts.length,
        reason: [summary, ...lines].filter(Boolean).join('\n'),
        score: Math.round((satisfied / verdicts.length) * 1000) / 1000,
        verdicts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problem = /invalid json/i.test(message) ? 'was not valid JSON' : 'could not be read';
      lastResult = {
        ...judgeErrorResult(`LLM judge failed: ${message}`),
        gating: true,
      };
    }
  }

  return lastResult;
};
