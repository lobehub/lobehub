import { type EvalFrozenCall } from '@lobechat/types';

import { toText } from './buildTranscript';

export interface FrozenTurn {
  role: string;
  text: string;
  /** Tool calls the turn made (assistant turns), by function name. */
  toolCalls: string[];
}

const nameOf = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { function?: { name?: unknown }; name?: unknown };
  if (typeof v.function?.name === 'string') return v.function.name;
  if (typeof v.name === 'string') return v.name;
  return undefined;
};

/** Tool names the model could see, in either the OpenAI (`{function:{name}}`) or flat shape. */
export const frozenToolNames = (tools?: unknown[] | null): string[] =>
  (tools ?? []).map(nameOf).filter((n): n is string => !!n);

/** The frozen messages as readable turns: text content plus the names of any tool calls. */
export const frozenTurns = (messages?: unknown[] | null): FrozenTurn[] =>
  (messages ?? []).map((raw) => {
    const m = (raw ?? {}) as { content?: unknown; role?: unknown; tool_calls?: unknown };
    const toolCalls = Array.isArray(m.tool_calls)
      ? m.tool_calls.map(nameOf).filter((n): n is string => !!n)
      : [];
    return {
      role: typeof m.role === 'string' ? m.role : 'user',
      text: toText(m.content),
      toolCalls,
    };
  });

/** A case's inline frozen call, or `undefined` for cases frozen before it was stored on the row. */
export const readFrozenCall = (value: unknown): EvalFrozenCall | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const fc = value as EvalFrozenCall;
  return Array.isArray(fc.messages) ? fc : undefined;
};
