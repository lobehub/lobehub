import type { ArtboardUserOp } from '@lobechat/types';

import { artboardService } from '@/services/artboard';

import { mutateArtboard } from './useArtboard';

export const submitUserOps = async (id: string, revision: number, ops: ArtboardUserOp[]) => {
  const result = await artboardService.applyUserOps(id, revision, ops);
  await mutateArtboard(id);
  return result;
};

export const decideQuestion = (id: string, revision: number, noteId: string, decision: string) =>
  submitUserOps(id, revision, [{ decision, noteId, type: 'decideQuestion' }]);

export const finalizeArtboard = async (id: string, revision: number) => {
  const result = await artboardService.finalize(id, revision);
  await mutateArtboard(id);
  return result;
};
