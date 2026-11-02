import { lambdaClient } from '@/libs/trpc/client';

type CanvasRouter = typeof lambdaClient.canvas;

export type CanvasVersionDetail = NonNullable<
  Awaited<ReturnType<CanvasRouter['getVersion']['query']>>
>;
export type CanvasVersionSummary = Awaited<
  ReturnType<CanvasRouter['listVersions']['query']>
>[number];

class CanvasService {
  /**
   * Delete a canvas with every version and file, freeing its storage.
   * `orphanOnly` frees only files left without a Work and skips a live canvas.
   */
  delete = (canvasId: string, options?: { orphanOnly?: boolean }) =>
    lambdaClient.canvas.delete.mutate({ canvasId, ...options });

  getProject = (canvasId: string, version: number) =>
    lambdaClient.canvas.getProject.query({ canvasId, version });

  getVersion = (canvasId: string, version?: number) =>
    lambdaClient.canvas.getVersion.query({ canvasId, version });

  listStorage = () => lambdaClient.canvas.listStorage.query();

  listVersions = (canvasId: string) => lambdaClient.canvas.listVersions.query({ canvasId });

  publish = (canvasId: string) => lambdaClient.canvas.publish.mutate({ canvasId });

  runAgentTool = (
    apiName: string,
    args: unknown,
    context: { agentId?: string; messageId?: string; threadId?: string; topicId?: string },
  ) =>
    lambdaClient.canvas.runAgentTool.mutate({
      apiName,
      args: (args ?? {}) as Record<string, unknown>,
      context,
    });
}

export const canvasService = new CanvasService();
