import type { SharedDocumentData } from '@lobechat/types';
import useSWR, { type SWRResponse } from 'swr';

import { lambdaClient } from '@/libs/trpc/client';

export const SHARED_PAGE_PROBE_KEY = (documentId: string) => [
  'share.getSharedDocument',
  documentId,
];

export const useSharedPageProbe = (
  documentId: string | undefined,
): SWRResponse<SharedDocumentData> => {
  return useSWR<SharedDocumentData>(
    documentId ? SHARED_PAGE_PROBE_KEY(documentId) : null,
    () => lambdaClient.share.getSharedDocument.query({ documentId: documentId! }),
    { revalidateOnFocus: false },
  );
};
