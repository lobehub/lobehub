import { useClientDataSWR } from '@/libs/swr';
import { canvasService } from '@/services/canvas';
import { useChatStore } from '@/store/chat';
import { dbMessageSelectors } from '@/store/chat/slices/message/selectors';

import { getLatestCanvasVersion, getLatestSavedManifestKey } from './latestCanvasVersion';
import { isActiveRunRunning } from './usePendingCanvasUpdate';

export interface CanvasTabView {
  canvasId: string;
  version?: number;
}

export const useCanvasTabView = (canvasId: string): CanvasTabView => {
  const version = useChatStore((s) => s.canvasTabVersions[canvasId]);

  return { canvasId, version };
};

const useLatestKnownVersion = (canvasId?: string) =>
  useChatStore((s) =>
    canvasId ? getLatestCanvasVersion(dbMessageSelectors.activeDbMessages(s), canvasId) : 0,
  );

export const useAwaitingCanvasSave = (view: CanvasTabView, shownManifestKey?: string) =>
  useChatStore((s) => {
    if (view.version || !shownManifestKey || !isActiveRunRunning(s)) return false;
    const saved = getLatestSavedManifestKey(dbMessageSelectors.activeDbMessages(s), view.canvasId);
    return !!saved && saved !== shownManifestKey;
  });

export const useCanvasVersion = (view: CanvasTabView) => {
  const latestKnown = useLatestKnownVersion(view.canvasId);
  const savedManifestKey = useChatStore((s) =>
    view.version
      ? undefined
      : getLatestSavedManifestKey(dbMessageSelectors.activeDbMessages(s), view.canvasId),
  );
  const running = useChatStore(isActiveRunRunning);

  const result = useClientDataSWR(
    ['canvas-version', view.canvasId, view.version ?? 'latest', latestKnown, savedManifestKey],
    () => canvasService.getVersion(view.canvasId, view.version),
    {
      keepPreviousData: true,
      // In the client loop the version row is registered just after the tool result lands.
      refreshInterval: (data) =>
        running && savedManifestKey && data?.metadata.manifestKey !== savedManifestKey ? 1000 : 0,
    },
  );

  return result.data && result.data.canvasId !== view.canvasId
    ? { ...result, data: undefined }
    : result;
};

export const useCanvasVersions = (canvasId?: string) => {
  const latestKnown = useLatestKnownVersion(canvasId);

  return useClientDataSWR(canvasId ? ['canvas-versions', canvasId, latestKnown] : null, () =>
    canvasService.listVersions(canvasId!),
  );
};
