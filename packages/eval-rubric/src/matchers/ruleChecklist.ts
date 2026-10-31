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
  '- "unverifiable": the materials show neither.',
  'A "Must not" rule is satisfied when nothing in the output or the evidence breaks it.',
  '',
  'Respond with a JSON object: {"rules": [{"index": <rule number>, "verdict": "satisfied" | "violated" | "unverifiable", "reason": "<one sentence>"}, ...], "summary": "<one sentence on the attempt>"}. Include every rule exactly once.',
].join('\n');

const VERDICTS = ['satisfied', 'violated', 'unverifiable'] as const;

const CHECKLIST_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    rules: {
      items: {
        additionalProperties: false,
        properties: {
          index: { description: 'The rule number, starting at 1', type: 'integer' },
          reason: { description: 'One sentence grounding the verdict', type: 'string' },
          verdict: { enum: VERDICTS, type: 'string' },
        },
        required: ['index', 'verdict', 'reason'],
        type: 'object',
      },
      type: 'array',
    },
    summary: { description: 'One sentence on the attempt as a whole', type: 'string' },
  },
  required: ['rules', 'summary'],
  type: 'object',
};

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
  if (expected) parts.push(`[Expected]\n${expected}`);
  return parts.join('\n\n');
}

interface JudgeRuleRow {
  index?: unknown;
  reason?: unknown;
  verdict?: unknown;
}

/** Require exactly one explicit verdict for every one-based rule in the schema. */
const readVerdicts = (rules: ChecklistRule[], rows: unknown[]): EvalRuleVerdict[] | undefined => {
  if (rows.length !== rules.length) return undefined;
  const byIndex = new Map<number, EvalRuleVerdict>();
  for (const value of rows) {
    const row = value as JudgeRuleRow | null | undefined;
    const index = row?.index;
    const verdict = VERDICTS.find((item) => item === row?.verdict);
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 1 ||
      index > rules.length ||
      byIndex.has(index) ||
      !verdict ||
      typeof row?.reason !== 'string'
    )
      return undefined;
    byIndex.set(index, {
      ...(row.reason && { reason: row.reason }),
      rule: ruleLabel(rules[index - 1]),
      verdict,
    });
  }
  return rules.map((_, position) => byIndex.get(position + 1)!);
};

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
  const messages = [
    { content: cfg.systemRole || DEFAULT_SYSTEM_ROLE, role: 'system' as const },
    {
      content: buildUserPrompt(rules, actual, expected, input, context.judgeEvidence),
      role: 'user' as const,
    },
  ];
  const maxAttempts = Math.max(1, context.judgeMaxAttempts ?? 3);

  let lastResult: MatchResult = {
    ...judgeErrorResult('LLM judge did not return rule verdicts'),
    gating: true,
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await context.generateObject({
        messages,
        model,
        provider: cfg.provider,
        schema: CHECKLIST_SCHEMA,
      });
      const verdicts = Array.isArray(result?.rules) ? readVerdicts(rules, result.rules) : undefined;
      if (!verdicts || typeof result?.summary !== 'string') {
        lastResult = {
          ...judgeErrorResult('LLM judge did not return rule verdicts'),
          gating: true,
        };
        continue;
      }

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
      lastResult = {
        ...judgeErrorResult(
          `LLM judge failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
        gating: true,
      };
    }
  }

  return lastResult;
};
