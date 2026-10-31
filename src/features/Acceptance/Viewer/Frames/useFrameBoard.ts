import type { AcceptanceFrameBoardView, AcceptanceFrameOperation } from '@lobechat/types';
import { toast } from '@lobehub/ui';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useClientDataSWR } from '@/libs/swr';
import { acceptanceFrameKeys } from '@/libs/swr/keys';
import { acceptanceFrameService } from '@/services/acceptanceFrame';
import { isTrpcErrorCode } from '@/utils/trpcError';

export const useFrameBoardData = (acceptanceId?: string | null) =>
  useClientDataSWR<AcceptanceFrameBoardView | null>(
    acceptanceId ? acceptanceFrameKeys.board(acceptanceId) : null,
    () => acceptanceFrameService.getBoard(acceptanceId!),
    { revalidateOnFocus: true },
  );

/**
 * The board plus its one write. Every write carries the version it was made
 * against, so two reviewers choosing at once cannot silently overwrite each
 * other: the loser reloads and sees the other choice.
 */
export const useFrameBoard = (acceptanceId?: string | null) => {
  const { t } = useTranslation('verify');
  const swr = useFrameBoardData(acceptanceId);
  const { data, mutate } = swr;

  const update = useCallback(
    async (frameId: string, operation: AcceptanceFrameOperation) => {
      if (!acceptanceId || !data) return false;
      try {
        await acceptanceFrameService.updateFrame(acceptanceId, frameId, operation, data.version);
        await mutate();
        return true;
      } catch (error) {
        console.error('[acceptance:frames]', error);
        if (isTrpcErrorCode(error, 'CONFLICT')) {
          toast.info(t('frames.conflict'));
          await mutate();
        } else toast.error(t('frames.updateFailed'));
        return false;
      }
    },
    [acceptanceId, data, mutate, t],
  );

  return { board: data ?? null, error: swr.error, isLoading: swr.isLoading, update };
};
