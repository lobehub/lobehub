import type { ArtboardCommentThreadView } from '@lobechat/types';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { artboardService } from '@/services/artboard';

import { useArtboardFeature } from '../useArtboardFeature';

const REFRESH_MS = 30_000;

export const artboardCommentsKey = (id: string) => ['artboard-comments', id] as const;

export const useArtboardComments = (id: string | undefined) => {
  const { enabled } = useArtboardFeature();
  return useClientDataSWR<ArtboardCommentThreadView[]>(
    enabled && id ? artboardCommentsKey(id) : null,
    () => artboardService.listComments(id!),
    { focusThrottleInterval: 0, refreshInterval: REFRESH_MS, revalidateOnFocus: true },
  );
};

export const mutateArtboardComments = (id: string) => mutate(artboardCommentsKey(id));
