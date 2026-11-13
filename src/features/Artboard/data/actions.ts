import { artboardService } from '@/services/artboard';

import { mutateArtboard } from './useArtboard';

export const finalizeArtboard = async (id: string, revision: number) => {
  const result = await artboardService.finalize(id, revision);
  await mutateArtboard(id);
  return result;
};
