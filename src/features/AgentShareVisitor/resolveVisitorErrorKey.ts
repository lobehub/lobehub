import { ChatErrorType } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

/**
 * Map a share-run failure to the visitor-facing copy key.
 *
 * Extracted so the mapping (including the tRPC `BAD_REQUEST` branch) is
 * unit-testable without rendering `VisitorComposer` — see
 * `resolveVisitorErrorKey.test.ts`.
 */
export const resolveVisitorErrorKey = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);

  // The server rejects an over-long `prompt` with a Zod-driven `BAD_REQUEST`
  // (see `SHARE_VISITOR_PROMPT_MAX_LENGTH` in `@lobechat/const`), not one of
  // the `ChatErrorType` values matched below — those are only embedded in
  // errors raised from inside the agent run itself. The client-side
  // `maxLength` mirror on the composer's `TextArea` should catch this before
  // the request goes out, but a direct RPC caller (or any future desync
  // between the two bounds) still needs actionable copy.
  //
  // Narrowed to the `prompt`/`too_big` issue rather than any `BAD_REQUEST`:
  // this procedure's schema can also reject a malformed `clientIds`/`topicId`,
  // and telling a visitor to shorten their message when the real fault is a
  // malformed id would be actively misleading. The lambda router installs no
  // `zodError` formatter, so the issue list only survives as tRPC's default
  // JSON-stringified `message`; anything that does not clearly match falls
  // through to the generic copy.
  if (
    error instanceof TRPCClientError &&
    error.data?.code === 'BAD_REQUEST' &&
    message.includes('too_big') &&
    message.includes('prompt')
  )
    return 'share.visitor.errors.promptTooLong';

  // The share itself stopped accepting traffic mid-session: the creator
  // paused it (a stranger on a private share gets NOT_FOUND 'Share not found'
  // from `assertShareAccess`, deliberately indistinguishable from a deleted
  // one), flipped it off `link` while previewing as owner
  // (`resolveLinkShareOrThrow` → FORBIDDEN), or deleted the topic
  // (NOT_FOUND 'Topic not found'). `useSharedAgent` never revalidates, so the
  // page keeps rendering the stale "everything is fine" shell — without this
  // branch the visitor only sees the generic copy and retries forever.
  if (error instanceof TRPCClientError) {
    if (error.data?.code === 'FORBIDDEN') return 'share.visitor.errors.sharingPaused';
    if (error.data?.code === 'NOT_FOUND') {
      // Share-level vs topic-level NOT_FOUND can only be told apart by the
      // server message (`shareChat.ts` / `AgentShareModel`): the share one is
      // terminal, the topic one must stay recoverable by switching / starting
      // a new topic (see `TERMINAL_VISITOR_ERROR_KEYS`).
      if (message === 'Share not found') return 'share.visitor.errors.sharingPaused';
      return 'share.visitor.errors.unavailable';
    }
  }

  if (message.includes(ChatErrorType.ShareTurnLimitExceeded))
    return 'share.visitor.errors.turnLimit';
  if (message.includes(ChatErrorType.ShareTopicLimitExceeded))
    return 'share.visitor.errors.topicLimit';
  // Deliberately NOT terminal: the cap is per calendar month and the owner can
  // raise it at any time, so the composer stays usable for a retry.
  if (message.includes(ChatErrorType.ShareSpendLimitExceeded))
    return 'share.visitor.errors.spendLimit';
  if (message.includes(ChatErrorType.InsufficientBudgetForModel))
    return 'share.visitor.errors.insufficientBudget';
  if (message.includes(ChatErrorType.AgentShareProviderNotSupported))
    return 'share.visitor.errors.providerNotSupported';
  if (message.includes(ChatErrorType.ShareHeterogeneousAgentUnsupported))
    return 'share.visitor.errors.heterogeneousUnsupported';

  return 'share.visitor.errors.generic';
};

/**
 * Failures that describe the share itself rather than one attempt, so retrying
 * (or switching topic) cannot clear them — the composer stays disabled and the
 * message survives a topic switch.
 */
const TERMINAL_VISITOR_ERROR_KEYS = new Set([
  // `unavailable` (NOT_FOUND) is intentionally absent: it may describe only the
  // current topic, so locking the composer for it would strand the visitor —
  // worst case a truly deleted share just fails again on the next send.
  'share.visitor.errors.sharingPaused',
]);

export const isTerminalVisitorError = (errorKey: string): boolean =>
  TERMINAL_VISITOR_ERROR_KEYS.has(errorKey);
