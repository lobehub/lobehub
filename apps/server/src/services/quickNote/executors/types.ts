import type { QuickNoteProposalKind } from '@lobechat/types';
import type { z } from 'zod';

import type { QuickNoteProposalItem } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import type { QuickNoteProposalPayloadMap } from './schemas';

/** Scope and handles an executor runs with. */
export interface QuickNoteExecutorContext {
  /** Transaction holding the Proposal row lock; every durable write goes through it. */
  db: LobeChatDatabase;
  /** The locked, pending Proposal being applied. */
  proposal: QuickNoteProposalItem;
  /** Analyze agent the user configured, or the builtin Quick Note agent, read through `db`. */
  resolveQuickNoteAgentId: (db: LobeChatDatabase) => Promise<string>;
  /** Connection outside the transaction, for work that must run after commit. */
  rootDb: LobeChatDatabase;
  userId: string;
  workspaceId?: string;
}

/** The product object an apply produced. */
export interface QuickNoteExecutorResult {
  /**
   * Non-durable kickoff that must only run once the apply committed (start a Task run, schedule
   * a Goal). Its failure is logged and never undoes the apply.
   */
  afterCommit?: () => Promise<void>;
  resultId: string;
  resultType: string;
}

/**
 * Applies one Proposal kind: validates its payload, then calls the owning domain service.
 *
 * Executors never call an LLM or start an Agent turn synchronously; long work is kicked off in
 * `afterCommit` through the domain's own queue.
 */
export interface QuickNoteProposalExecutor<
  K extends QuickNoteProposalKind = QuickNoteProposalKind,
> {
  execute: (
    ctx: QuickNoteExecutorContext,
    payload: QuickNoteProposalPayloadMap[K],
  ) => Promise<QuickNoteExecutorResult>;
  kind: K;
  schema: z.ZodType<QuickNoteProposalPayloadMap[K]>;
}

export type QuickNoteProposalExecutorRegistry = {
  [K in QuickNoteProposalKind]: QuickNoteProposalExecutor<K>;
};

export type QuickNoteApplyErrorCode =
  | 'forbidden'
  | 'invalid_payload'
  | 'not_found'
  | 'not_pending'
  | 'tool_failed'
  | 'unsupported_target'
  | 'unsupported_tool';

/** A Proposal that cannot be applied as stored; the user can edit or dismiss it. */
export class QuickNoteApplyError extends Error {
  readonly code: QuickNoteApplyErrorCode;

  constructor(code: QuickNoteApplyErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'QuickNoteApplyError';
    this.code = code;
  }
}
