import { ArtboardApiName, type ArtboardToolState } from '@lobechat/builtin-tool-artboard';

import { artboardActions, useArtboardStore } from '../store';
import { mutateArtboard } from './useArtboard';
import { mutateArtboardComments } from './useArtboardComments';

const WRITE_APIS = new Set<string>([
  ArtboardApiName.createArtboard,
  ArtboardApiName.updateArtboard,
]);

const COMMENT_APIS = new Set<string>([
  ArtboardApiName.askArtboardQuestion,
  ArtboardApiName.replyArtboardComment,
  ArtboardApiName.resolveArtboardComment,
]);

interface ArtboardToolOutcome {
  apiName: string;
  result: { state?: unknown; success?: boolean };
}

export const onArtboardToolResult = async ({ apiName, result }: ArtboardToolOutcome) => {
  if (result.success === false) return;
  const state = result.state as Partial<ArtboardToolState> | undefined;

  if (COMMENT_APIS.has(apiName)) {
    const artboardId = state?.artboardId ?? useArtboardStore.getState().boardId;
    if (artboardId)
      await Promise.all([mutateArtboard(artboardId), mutateArtboardComments(artboardId)]);
    return;
  }

  if (!WRITE_APIS.has(apiName) || !state?.artboardId) return;

  await mutateArtboard(state.artboardId);
  if (useArtboardStore.getState().boardId === state.artboardId)
    artboardActions.flashItems(state.changedIds ?? []);
};
