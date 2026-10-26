import type { VerifyCheckItem } from '@lobechat/types';

import type { DocumentModel } from '@/database/models/document';

/**
 * A check item's detailed judging instruction. A structured criterion carries
 * its frozen definition and resource snapshot in the plan, and that payload is
 * the contract; otherwise the rule body lives in the linked document. Shared by
 * the verifier and dispute arbitration so the panel rules on exactly the
 * contract the verifier enforced.
 */
export const resolveCheckInstruction = async (
  documentModel: Pick<DocumentModel, 'findById'>,
  item: Pick<VerifyCheckItem, 'definition' | 'documentId' | 'resourceSnapshot'>,
): Promise<string | undefined> => {
  if (item.definition || item.resourceSnapshot)
    return JSON.stringify({ definition: item.definition, resources: item.resourceSnapshot });
  if (!item.documentId) return undefined;
  const doc = await documentModel.findById(item.documentId);
  return doc?.content ?? undefined;
};
