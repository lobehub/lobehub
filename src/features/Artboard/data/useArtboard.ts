import { mutate, useClientDataSWR } from '@/libs/swr';
import { artboardService, type ArtboardView } from '@/services/artboard';

export const artboardSWRKey = (id: string) => ['artboard', id] as const;

export const useArtboard = (id: string | undefined) =>
  useClientDataSWR<ArtboardView>(id ? artboardSWRKey(id) : null, () => artboardService.get(id!));

export const mutateArtboard = (id: string, data?: ArtboardView) =>
  data ? mutate(artboardSWRKey(id), data, { revalidate: false }) : mutate(artboardSWRKey(id));
