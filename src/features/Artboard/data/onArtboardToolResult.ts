import { ArtboardApiName, type ArtboardToolState } from '@lobechat/builtin-tool-artboard';

import { artboardActions, useArtboardStore } from '../store';
import { mutateArtboard } from './useArtboard';

const WRITE_APIS = new Set<string>([
  ArtboardApiName.createArtboard,
  ArtboardApiName.updateArtboard,
]);

interface ArtboardToolOutcome {
  apiName: string;
  result: { state?: unknown; success?: boolean };
}

export const onArtboardToolResult = async ({ apiName, result }: ArtboardToolOutcome) => {
  if (!WRITE_APIS.has(apiName) || result.success === false) return;
  const state = result.state as Partial<ArtboardToolState> | undefined;
  if (!state?.artboardId) return;

  await mutateArtboard(state.artboardId);
  if (useArtboardStore.getState().boardId === state.artboardId)
    artboardActions.flashItems(state.changedIds ?? []);
};
