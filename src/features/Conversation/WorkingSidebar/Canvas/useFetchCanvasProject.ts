import { prepareCanvasProject } from '@lobechat/canvas/preview';

import { useClientDataSWR } from '@/libs/swr';
import { canvasService } from '@/services/canvas';

export const useFetchCanvasProject = (canvasId: string, version: number) =>
  useClientDataSWR(
    ['canvas-project', canvasId, version],
    async () => prepareCanvasProject(await canvasService.getProject(canvasId, version)),
    {
      dedupingInterval: Infinity,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
