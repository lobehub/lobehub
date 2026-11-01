import type { AcceptanceCommentList } from '@lobechat/types';

import { useClientDataSWR } from '@/libs/swr';
import { acceptanceCommentKeys } from '@/libs/swr/keys';
import { acceptanceCommentService } from '@/services/acceptanceComment';

/** Read access only. Hosts that display discussion need not mount its write actions. */
export const useAcceptanceCommentList = (acceptanceId?: string) =>
  useClientDataSWR<AcceptanceCommentList>(
    acceptanceId ? acceptanceCommentKeys.list(acceptanceId) : null,
    () => acceptanceCommentService.list(acceptanceId!),
    { revalidateOnFocus: true },
  );
