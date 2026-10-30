import { z } from 'zod';

/**
 * A subagent preset: a named configuration a parent agent can delegate a
 * sub-task to. It is configuration only — it never shows up in the agent list,
 * market or share flows, and threads it ran are linked through
 * `threads.subagent_id`.
 *
 * A preset carries exactly one model choice (model + provider, optionally a
 * reasoning effort); multi-model routing is deliberately out of scope.
 */
export interface SubagentItem {
  createdAt: Date;
  description: string | null;
  id: string;
  isEnabled: boolean;
  model: string | null;
  name: string;
  parentAgentId: string;
  provider: string | null;
  /** Free-form because the accepted values differ per model family. */
  reasoningEffort: string | null;
  systemRole: string | null;
  /** Tool identifiers the subagent may call; `null` inherits the parent's tools. */
  tools: string[] | null;
  updatedAt: Date;
}

export const createSubagentSchema = z.object({
  description: z.string().nullish(),
  isEnabled: z.boolean().optional(),
  model: z.string().nullish(),
  name: z.string().trim().min(1).max(100),
  parentAgentId: z.string(),
  provider: z.string().nullish(),
  reasoningEffort: z.string().nullish(),
  systemRole: z.string().nullish(),
  tools: z.array(z.string()).nullish(),
});

export type CreateSubagentParams = z.infer<typeof createSubagentSchema>;

export const updateSubagentSchema = createSubagentSchema.omit({ parentAgentId: true }).partial();

export type UpdateSubagentParams = z.infer<typeof updateSubagentSchema>;

/** Per-subagent thread statistics, keyed by `subagentId`. */
export interface SubagentThreadStat {
  subagentId: string;
  threadCount: number;
  /** Sum of assistant `usage.totalTokens` across the subagent's threads. */
  totalTokens: number;
}
