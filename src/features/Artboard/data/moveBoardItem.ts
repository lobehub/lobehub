import type { ArtboardUserOp } from '@lobechat/types';
import { TRPCClientError } from '@trpc/client';

import { artboardService, type ArtboardView } from '@/services/artboard';

import { mutateArtboard } from './useArtboard';

const isConflict = (error: unknown) =>
  error instanceof TRPCClientError && error.data?.code === 'CONFLICT';

const hasItem = (view: ArtboardView, itemId: string) => {
  const { frames, notes } = view.artboard.content;
  return frames.some((f) => f.id === itemId) || notes.some((n) => n.id === itemId);
};

const withItemAt = (view: ArtboardView, itemId: string, x: number, y: number): ArtboardView => {
  const move = <T extends { id: string; x: number; y: number }>(item: T) =>
    item.id === itemId ? { ...item, x, y } : item;
  const { content } = view.artboard;
  return {
    ...view,
    artboard: {
      ...view.artboard,
      content: { ...content, frames: content.frames.map(move), notes: content.notes.map(move) },
    },
  };
};

export const moveBoardItem = async (
  view: ArtboardView,
  itemId: string,
  x: number,
  y: number,
  onShown?: () => void,
) => {
  const { id, revision } = view.artboard;
  const ops: ArtboardUserOp[] = [{ id: itemId, type: 'moveItem', x, y }];
  await mutateArtboard(id, withItemAt(view, itemId, x, y));
  onShown?.();

  try {
    await artboardService.applyUserOps(id, revision, ops);
  } catch (error) {
    if (!isConflict(error)) {
      await mutateArtboard(id);
      throw error;
    }
    const latest = await artboardService.get(id);
    if (!hasItem(latest, itemId)) {
      await mutateArtboard(id, latest);
      return;
    }
    await mutateArtboard(id, withItemAt(latest, itemId, x, y));
    await artboardService.applyUserOps(id, latest.artboard.revision, ops);
  }
  await mutateArtboard(id);
};
