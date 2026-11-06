import { mutate, useClientDataSWR } from '@/libs/swr';
import { artboardService, type ArtboardView } from '@/services/artboard';

import { useArtboardFeature } from '../useArtboardFeature';

export const artboardSWRKey = (id: string) => ['artboard', id] as const;

export const useArtboard = (id: string | undefined) => {
  const { enabled } = useArtboardFeature();
  return useClientDataSWR<ArtboardView>(enabled && id ? artboardSWRKey(id) : null, () =>
    artboardService.get(id!),
  );
};

export const mutateArtboard = (id: string, data?: ArtboardView) =>
  data ? mutate(artboardSWRKey(id), data, { revalidate: false }) : mutate(artboardSWRKey(id));
