import {
  DOCUMENT_CHAR_LIMIT_EXCEEDED,
  type DocumentCharLimitErrorData,
  type DocumentWriteSource,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';

import { checkDocumentCharLimit } from '@/business/server/document/writeLimit';

export interface AssertDocumentWriteWithinLimitParams {
  /** Length of the document after the write, in UTF-16 code units. */
  charCount: number;
  /** Length before the write; `0` for a new document. */
  previousCharCount?: number;
  /** Defaults to `user`; pass `system` for writes the user did not ask for. */
  source?: DocumentWriteSource;
  userId: string;
  workspaceId?: string | null;
}

/**
 * Message for a refused write. The agent runtime passes only the message to the
 * model, so it carries the numbers and what to do instead. Numbers stay plain
 * digits: tool error classification treats a 3-digit 4xx/5xx token as an HTTP
 * status.
 */
export const formatDocumentCharLimitMessage = ({
  actual,
  limit,
  plan,
}: Omit<DocumentCharLimitErrorData, 'code'>) =>
  `Document is too long: ${actual} characters, over the ${limit}-character limit per document` +
  `${plan ? ` on the current plan (${plan})` : ''}. ` +
  'Split the content into several documents or shorten it.';

/**
 * Refuses a write that would leave a document longer than the caller's
 * per-document character limit. A write that does not make the document longer
 * always passes, so a document already over the limit stays editable.
 */
export const assertDocumentWriteWithinLimit = async ({
  charCount,
  previousCharCount = 0,
  source = 'user',
  userId,
  workspaceId,
}: AssertDocumentWriteWithinLimitParams): Promise<void> => {
  if (source === 'system' || charCount <= previousCharCount) return;

  const result = await checkDocumentCharLimit({ charCount, source, userId, workspaceId });
  if (result.allowed) return;

  const data: DocumentCharLimitErrorData = {
    actual: charCount,
    code: DOCUMENT_CHAR_LIMIT_EXCEEDED,
    limit: result.limit,
    plan: result.plan,
  };
  throw new TRPCError({
    cause: { data },
    code: 'BAD_REQUEST',
    message: formatDocumentCharLimitMessage(data),
  });
};
