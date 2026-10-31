import { TRPCError } from '@trpc/server';
import pMap from 'p-map';

import type { WorkModel } from '@/database/models/work';

const CANVAS_REF_CONCURRENCY = 5;

export interface CanvasRef {
  canvasId: string;
  canvasVersion: number;
}

/**
 * Every reference must name a Canvas version the caller can open. A typo
 * would otherwise surface only as a blank frame in front of reviewers.
 */
export const assertCanvasRefs = async (workModel: WorkModel, refs: Iterable<CanvasRef>) => {
  const unique = new Map<string, CanvasRef>();
  for (const { canvasId, canvasVersion } of refs)
    unique.set(`${canvasId}@${canvasVersion}`, { canvasId, canvasVersion });

  await pMap(
    unique.values(),
    async ({ canvasId, canvasVersion }) => {
      const current = await workModel.findCanvas(canvasId);
      const version =
        current && canvasVersion === current.version.version
          ? current.version
          : current && (await workModel.findCanvasVersion(current.work.id, canvasVersion));
      if (!version?.metadata?.canvas)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Canvas ${canvasId} has no version ${canvasVersion}`,
        });
    },
    { concurrency: CANVAS_REF_CONCURRENCY },
  );
};
