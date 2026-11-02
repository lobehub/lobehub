import { DocumentApiName, PageAgentIdentifier } from '@lobechat/builtin-tool-page-agent';
import type { QuickNoteProposalKind } from '@lobechat/types';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

/** `task` Proposal: create and run a research Task. */
export const quickNoteTaskPayloadSchema = z.object({
  /** Full brief the Task's agent receives. */
  instruction: text(8000),
  /** Short Task title. */
  name: text(120),
});

/** `topic` Proposal: open a conversation seeded with the note. */
export const quickNoteTopicPayloadSchema = z.object({
  /** Agent to talk to; defaults to the user's Inbox agent. */
  agentId: z.string().trim().min(1).optional(),
  /** First user message of the conversation. */
  openingMessage: text(8000),
  title: text(120),
});

/** `goal` Proposal: create and start a Goal. */
export const quickNoteGoalPayloadSchema = z.object({
  /** The ask in the user's words, shown on the Goal's problem node. */
  problemDescription: z.string().trim().max(2000).optional(),
  /** What "done" means; every Task of the Goal reads it. */
  requirement: text(8000),
  title: text(120),
});

/**
 * Built-in tool calls a `tool_call` Proposal may execute directly, keyed by identifier, then API.
 *
 * Only tools that need no agent conversation are listed. Others must go through an Agent run
 * with a tool-approval intervention and are rejected at apply time.
 *
 * - `initPage` (no `documentId`): writes the Markdown into a new private Page.
 * - `modifyNodes` (with `documentId`): inserts the Markdown after the last node of an existing
 *   Page. The insert position is resolved at apply time, so the stored arguments carry only the
 *   Markdown and never go stale against node ids.
 */
export const QUICK_NOTE_DIRECT_TOOL_CALLS = {
  [PageAgentIdentifier]: [DocumentApiName.initPage, DocumentApiName.modifyNodes],
} as const satisfies Record<string, readonly string[]>;

/** `tool_call` Proposal: one built-in tool call with fixed arguments. */
export const quickNoteToolCallPayloadSchema = z.object({
  apiName: text(120),
  arguments: z.record(z.string(), z.unknown()),
  /**
   * Existing Page the call writes into (`modifyNodes`, appended at the end). Omitted to write
   * into a new private Page created at apply time (`initPage`).
   */
  documentId: z.string().trim().min(1).optional(),
  identifier: text(120),
  /** Title of the Page created at apply time; ignored when writing into an existing Page. */
  title: text(200).optional(),
});

/**
 * `write_document` arguments for both page writes: `initPage` into a new Page, or `modifyNodes`
 * appending to an existing one.
 */
export const quickNotePageWriteArgumentsSchema = z.object({ markdown: text(50_000) });

export const QUICK_NOTE_PROPOSAL_PAYLOAD_SCHEMAS = {
  goal: quickNoteGoalPayloadSchema,
  task: quickNoteTaskPayloadSchema,
  tool_call: quickNoteToolCallPayloadSchema,
  topic: quickNoteTopicPayloadSchema,
} as const satisfies Record<QuickNoteProposalKind, z.ZodType>;

export type QuickNoteTaskPayload = z.infer<typeof quickNoteTaskPayloadSchema>;
export type QuickNoteTopicPayload = z.infer<typeof quickNoteTopicPayloadSchema>;
export type QuickNoteGoalPayload = z.infer<typeof quickNoteGoalPayloadSchema>;
export type QuickNoteToolCallPayload = z.infer<typeof quickNoteToolCallPayloadSchema>;

export interface QuickNoteProposalPayloadMap {
  goal: QuickNoteGoalPayload;
  task: QuickNoteTaskPayload;
  tool_call: QuickNoteToolCallPayload;
  topic: QuickNoteTopicPayload;
}
