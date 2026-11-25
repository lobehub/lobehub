import { z } from 'zod';

import type { OpenAIChatMessage } from '../../openai/chat';

/** A rendered machine contribution. The anchor describes its historical placement. */
export interface ContextReplaySegment {
  key: string;
  messages: Array<OpenAIChatMessage & { id: string }>;
  sourceIds: string[];
}

/** One logical LLM invocation's immutable delta; stored before dispatch, never in Redis state. */
export interface ContextReplaySnapshot {
  changes: ContextReplaySegment[];
  createdBy?: string;
  invalidated?: boolean;
  invocationId: string;
  parentSnapshotId?: string;
  sessionKey: string;
  sourceIds: string[];
  /** Present at the start of a baseline, not copied into every subsequent delta. */
  system?: OpenAIChatMessage[];
  version: 1;
}

export interface ContextReplayInput {
  committedSnapshot?: ContextReplaySnapshot;
  invocationId: string;
  resetHistory?: boolean;
  /** Current access decisions, checked again even when retrying a committed snapshot. */
  revokedSourceIds?: string[];
  runtimeContext?: Record<string, string | number | boolean | string[] | undefined>;
  sessionKey?: string;
  sourceIdsByProvider?: Record<string, string[]>;
  /** Host authorization; a failed lookup is treated as revoked, never as allowed. */
  validateSources?: (sourceIds: string[]) => Promise<string[]>;
}

const ReplayMessageSchema = z.object({
  content: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  tool_call_id: z.string().optional(),
  tool_calls: z
    .array(
      z.object({
        function: z.object({ arguments: z.string(), name: z.string() }),
        id: z.string(),
        type: z.literal('function'),
      }),
    )
    .optional(),
});

export const ContextReplaySnapshotSchema: z.ZodType<ContextReplaySnapshot> = z.object({
  invalidated: z.boolean().optional(),
  changes: z.array(
    z.object({
      key: z.string(),
      messages: z.array(ReplayMessageSchema.extend({ id: z.string() })),
      sourceIds: z.array(z.string()),
    }),
  ),
  createdBy: z.string().optional(),
  invocationId: z.string(),
  parentSnapshotId: z.string().optional(),
  sessionKey: z.string(),
  sourceIds: z.array(z.string()),
  system: z.array(ReplayMessageSchema).optional(),
  version: z.literal(1),
});
