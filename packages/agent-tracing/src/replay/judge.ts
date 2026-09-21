import { type MatchContext } from '@lobechat/eval-rubric';

const JUDGE_SCHEMA_NAME = 'eval_judge_score';

/**
 * Back `eval-rubric`'s LLM judge with the authenticated `/webapi/chat` route so
 * replay scoring runs the exact same matcher the eval pipeline uses — only the
 * transport is local.
 */
export const createJudgeContext = ({
  headers,
  judgeModel,
  serverUrl,
}: {
  headers: Record<string, string>;
  judgeModel: { model: string; provider: string };
  serverUrl: string;
}): MatchContext => ({
  generateObject: async ({ messages, schema }) => {
    const res = await fetch(`${serverUrl}/webapi/chat/${judgeModel.provider}`, {
      body: JSON.stringify({
        messages,
        model: judgeModel.model,
        response_format: {
          json_schema: { name: JUDGE_SCHEMA_NAME, schema, strict: true },
          type: 'json_schema',
        },
        responseMode: 'json',
        stream: false,
      }),
      headers,
      method: 'POST',
    });

    if (!res.ok) throw new Error(`Judge request failed: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      content?: Array<{ text?: unknown }>;
    };
    const raw =
      (typeof body?.choices?.[0]?.message?.content === 'string'
        ? (body.choices[0].message.content as string)
        : undefined) ??
      body?.content?.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('') ??
      '';

    return parseJudgeResponse(raw);
  },
  judgeModel: judgeModel.model,
});

/**
 * Providers that ignore `response_format` still tend to emit the object inside
 * prose or a fenced block, so fall back to the first balanced `{...}` span
 * rather than failing the whole replay on a formatting quirk.
 */
export const parseJudgeResponse = (raw: string): { reason: string; score: number } => {
  const candidates = [raw, extractJsonSpan(raw)].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { reason?: unknown; score?: unknown };
      if (typeof parsed?.score === 'number' && Number.isFinite(parsed.score)) {
        return {
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
          score: parsed.score,
        };
      }
    } catch {
      // try the next candidate
    }
  }

  throw new Error(`Judge did not return a parseable score. Raw response: ${raw.slice(0, 200)}`);
};

const extractJsonSpan = (raw: string): string | undefined => {
  const start = raw.indexOf('{');
  if (start < 0) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index++) {
    const char = raw[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, index + 1);
    }
  }

  return undefined;
};
