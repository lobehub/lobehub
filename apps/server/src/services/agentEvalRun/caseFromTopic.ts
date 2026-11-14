import { getActivePluginIds } from '@lobechat/types';

import { initModelRuntimeForRequest } from '@/server/modules/AgentRuntime/llmRelay/oneShot';

import { resolveEvalJudge } from './judge';
import type { EvalRunDeps } from './types';
import { log } from './utils';

/**
 * A case drafted from one of the account's conversations.
 *
 * The conversation's last request is the case input, the messages before it
 * replay as context, the Agent that answered (persona, tools, model) is kept
 * as the case's own Agent setup, and the judge model drafts the Must / Must
 * not rules from what happened. Nothing is saved here: the draft goes back to
 * the UI, where the author edits the rules and saves the case.
 */

export interface TopicCaseDraft {
  agent?: {
    model?: string;
    name?: string | null;
    plugins: string[];
    provider?: string;
    systemRole?: string;
    title?: string | null;
  };
  /** The reply the conversation recorded; kept as provenance, never as the expected answer. */
  answer?: string;
  input: string;
  messages: Array<{ content: string; createdAt?: string; role: 'assistant' | 'user' }>;
  rules: string[];
  /** Why no rules were drafted, when the judge call failed; the author writes them. */
  rulesError?: string;
  sessionDate?: string;
  title: string;
  /** Connectors the recorded answer called, so the author knows what the case depends on. */
  toolsUsed: string[];
}

export const TOPIC_NOT_FOUND = 'Topic not found';
export const TOPIC_HAS_NO_REQUEST = 'The conversation has no user message to test';

const MAX_PROMPT_CHARS = 4000;

const text = (content: unknown): string => (typeof content === 'string' ? content : '');

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const RULES_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    rules: {
      description: 'Three to seven rules, each one line starting with "Must:" or "Must not:"',
      items: { type: 'string' },
      type: 'array',
    },
  },
  required: ['rules'],
  type: 'object',
};

const DRAFT_SYSTEM_ROLE = [
  'You write the grading rules of an evaluation case for an AI agent.',
  'From the conversation, write 3 to 7 rules that a correct answer to the final request must meet. Each rule is one line starting with "Must:" or "Must not:".',
  'Rules cover the actions a correct answer takes (which tools it calls, what it changes), the content it has to deliver, and what it must not do. Every rule must be checkable from the reply and the tool calls.',
  'Do not grade style or tone, do not quote or reward the recorded answer, and do not invent facts the conversation does not contain.',
  'Respond with a JSON object: {"rules": ["Must: …", "Must not: …"]}.',
].join('\n');

const normalizeRule = (rule: string) => {
  const line = rule.trim().replace(/^[-*•]\s*/, '');
  if (!line) return '';
  if (/^must(?:\s+not)?\s*[:：]/i.test(line)) return line;
  return `Must: ${line}`;
};

async function draftRulesWithJudge(
  deps: EvalRunDeps,
  draft: TopicCaseDraft,
  benchmarkMetadata?: Record<string, unknown> | null,
): Promise<string[]> {
  const judge = await resolveEvalJudge(deps, { benchmarkMetadata });
  const runtime = await initModelRuntimeForRequest(deps.db, deps.userId, judge.provider, {
    workspaceId: deps.workspaceId,
  });
  const sections = [
    draft.agent?.systemRole && `[Agent persona]\n${clip(draft.agent.systemRole, 2000)}`,
    draft.agent?.plugins.length && `[Agent tools]\n${draft.agent.plugins.join(', ')}`,
    draft.messages.length > 0 &&
      `[Earlier conversation]\n${clip(
        draft.messages.map((m) => `${m.role}: ${m.content}`).join('\n'),
        MAX_PROMPT_CHARS,
      )}`,
    `[Final request]\n${clip(draft.input, MAX_PROMPT_CHARS)}`,
    draft.answer && `[Recorded answer]\n${clip(draft.answer, MAX_PROMPT_CHARS)}`,
    draft.toolsUsed.length > 0 &&
      `[Tools the recorded answer called]\n${draft.toolsUsed.join(', ')}`,
  ].filter(Boolean);

  const result = await (runtime as any).generateObject(
    {
      messages: [
        { content: DRAFT_SYSTEM_ROLE, role: 'system' },
        { content: sections.join('\n\n'), role: 'user' },
      ],
      model: judge.model,
      schema: { name: 'case_rules', schema: RULES_SCHEMA },
    },
    { metadata: { trigger: 'eval-judge' } },
  );
  const rules = Array.isArray(result?.rules) ? (result.rules as unknown[]) : [];
  return rules
    .filter((rule): rule is string => typeof rule === 'string')
    .map(normalizeRule)
    .filter(Boolean);
}

export async function draftCaseFromTopic(
  deps: EvalRunDeps,
  topicId: string,
  options: {
    /** The benchmark whose Settings judge drafts the rules; the system default without one. */
    benchmarkId?: string;
    draftRules?: boolean;
  } = {},
): Promise<TopicCaseDraft> {
  const topic = await deps.topicModel.findById(topicId);
  if (!topic) throw new Error(TOPIC_NOT_FOUND);

  const rows = [...(await deps.messageModel.query({ topicId }))].sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
  );
  let requestIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role === 'user' && text(rows[i].content).trim()) {
      requestIndex = i;
      break;
    }
  }
  if (requestIndex < 0) throw new Error(TOPIC_HAS_NO_REQUEST);

  const request = rows[requestIndex];
  const after = rows.slice(requestIndex + 1);
  const toolsUsed = [
    ...new Set(
      after
        .filter((row) => row.role === 'tool' && row.plugin?.identifier)
        .map((row) => row.plugin!.identifier as string),
    ),
  ];
  const answer = after.findLast((row) => row.role === 'assistant' && text(row.content).trim());

  let agent: TopicCaseDraft['agent'];
  if (topic.agentId) {
    try {
      const config = await deps.agentService.getAgentConfigById(topic.agentId);
      if (config) {
        agent = {
          model: config.model ?? undefined,
          name: (config as { name?: string | null }).name ?? null,
          plugins: getActivePluginIds(config.plugins as any),
          provider: config.provider ?? undefined,
          systemRole: config.systemRole ?? undefined,
          title: config.title ?? null,
        };
      }
    } catch (error) {
      // The Agent may be gone; the case can still be saved without its setup.
      log('case from topic %s: agent %s unavailable: %O', topicId, topic.agentId, error);
    }
  }

  const input = text(request.content).trim();
  const draft: TopicCaseDraft = {
    agent,
    answer: answer ? text(answer.content).trim() : undefined,
    input,
    messages: rows
      .slice(0, requestIndex)
      .filter(
        (row) => (row.role === 'user' || row.role === 'assistant') && text(row.content).trim(),
      )
      .map((row) => ({
        content: text(row.content),
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : undefined,
        role: row.role as 'assistant' | 'user',
      })),
    rules: [],
    sessionDate: request.createdAt
      ? new Date(request.createdAt).toISOString().slice(0, 10)
      : undefined,
    title: input.replaceAll(/\s+/g, ' ').slice(0, 80),
    toolsUsed,
  };

  if (options.draftRules !== false) {
    try {
      const benchmark = options.benchmarkId
        ? await deps.benchmarkModel.findById(options.benchmarkId)
        : undefined;
      draft.rules = await draftRulesWithJudge(deps, draft, benchmark?.metadata);
    } catch (error) {
      log('case from topic %s: rule draft failed: %O', topicId, error);
      draft.rulesError = error instanceof Error ? error.message : String(error);
    }
  }

  return draft;
}
