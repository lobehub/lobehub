import { match } from '@lobechat/eval-rubric';

import { createJudgeContext } from './judge';
import {
  buildReplayRequest,
  extractCompletionText,
  extractToolCalls,
  type FrozenCall,
  type ModelTarget,
} from './payload';

const JUDGE_THRESHOLD = 0.6;

export interface ReplayAttempt {
  content: string;
  durationMs: number;
  error?: string;
  judge?: { passed: boolean; reason?: string; score: number };
  model: string;
  toolCalls: Array<{ arguments?: string; name: string }>;
  usage?: { completionTokens?: number; promptTokens?: number };
}

/** How a caller reaches `/webapi/chat/<provider>` — CLIs differ only in auth. */
export interface ReplayConnection {
  headers: Record<string, string>;
  serverUrl: string;
}

export interface ReplayFrozenCallParams {
  call: FrozenCall;
  connection: ReplayConnection;
  maxTokens?: number;
  target: ModelTarget;
  temperature?: number;
  withTools?: boolean;
}

/**
 * Re-issue one frozen call against one model. Transport errors are returned on
 * the attempt rather than thrown so a failing model in a multi-model sweep does
 * not abort the models after it.
 */
export const replayFrozenCall = async ({
  call,
  connection,
  maxTokens,
  target,
  temperature,
  withTools = true,
}: ReplayFrozenCallParams): Promise<ReplayAttempt> => {
  const request = buildReplayRequest({ call, maxTokens, target, temperature, withTools });
  const startedAt = Date.now();

  try {
    const res = await fetch(`${connection.serverUrl}/webapi/chat/${target.provider}`, {
      body: JSON.stringify(request),
      headers: connection.headers,
      method: 'POST',
    });

    if (!res.ok) {
      return {
        content: '',
        durationMs: Date.now() - startedAt,
        error: `${res.status} ${await res.text()}`,
        model: target.label,
        toolCalls: [],
      };
    }

    const body = (await res.json()) as {
      usage?: { completion_tokens?: number; prompt_tokens?: number };
    };

    return {
      content: extractCompletionText(body),
      durationMs: Date.now() - startedAt,
      model: target.label,
      toolCalls: extractToolCalls(body),
      usage: {
        completionTokens: body?.usage?.completion_tokens,
        promptTokens: body?.usage?.prompt_tokens,
      },
    };
  } catch (error) {
    return {
      content: '',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      model: target.label,
      toolCalls: [],
    };
  }
};

export interface JudgeReplayParams {
  actual: string;
  connection: ReplayConnection;
  criteria: string;
  /** Reference output, shown to the judge as `[Expected]`. */
  expected?: string;
  judgeModel: ModelTarget;
}

/**
 * Score a replayed output through `eval-rubric`'s `llm-rubric` matcher, so a
 * score printed here means what the same score means in an eval run — only the
 * transport is local.
 */
export const judgeReplay = async ({
  actual,
  connection,
  criteria,
  expected,
  judgeModel,
}: JudgeReplayParams): Promise<ReplayAttempt['judge']> => {
  const result = await match(
    {
      actual,
      expected,
      input: '',
      rubric: {
        config: { criteria },
        id: 'replay-judge',
        name: 'replay-judge',
        threshold: JUDGE_THRESHOLD,
        type: 'llm-rubric',
        weight: 1,
      },
    },
    createJudgeContext({ ...connection, judgeModel }),
  );

  return { passed: result.passed, reason: result.reason, score: result.score };
};
