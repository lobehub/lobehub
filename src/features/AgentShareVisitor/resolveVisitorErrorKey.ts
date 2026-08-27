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
  // (see `SHARE_VISITOR_PROMPT_MAX_LENGTH` in `@lobechat/const/agentShare`),
  // not one of the `ChatErrorType` values matched below — those are only
  // embedded in errors raised from inside the agent run itself. The
  // client-side `maxLength` mirror on the composer's `TextArea` should catch
  // this before the request goes out, but a direct RPC caller (or any future
  // desync between the two bounds) still needs actionable copy instead of
  // the generic fallback.
  //
  // Narrowed to the `prompt`/`too_big` issue rather than any `BAD_REQUEST`:
  // this procedure's schema can also reject a malformed `clientIds`/`topicId`,
  // and telling a visitor to shorten their message when the real fault is a
  // malformed id would be actively misleading. The lambda router installs no
  // `zodError` formatter (`packages/trpc/src/lambda/init.ts`), so the issue
  // list only survives as tRPC's default JSON-stringified `message`; anything
  // that does not clearly match falls through to the generic copy.
  if (
    error instanceof TRPCClientError &&
    error.data?.code === 'BAD_REQUEST' &&
    message.includes('too_big') &&
    message.includes('prompt')
  )
    return 'share.visitor.errors.promptTooLong';

  if (message.includes(ChatErrorType.ShareTurnLimitExceeded))
    return 'share.visitor.errors.turnLimit';
  if (message.includes(ChatErrorType.ShareTopicLimitExceeded))
    return 'share.visitor.errors.topicLimit';
  if (message.includes(ChatErrorType.InsufficientBudgetForModel))
    return 'share.visitor.errors.insufficientBudget';
  if (message.includes(ChatErrorType.AgentShareProviderNotSupported))
    return 'share.visitor.errors.providerNotSupported';
  if (message.includes(ChatErrorType.ShareHeterogeneousAgentUnsupported))
    return 'share.visitor.errors.heterogeneousUnsupported';
  return 'share.visitor.errors.generic';
};
