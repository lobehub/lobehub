import type { ComfyApi, NodeData, PromptBuilder, TProgress } from '@saintno/comfyui-sdk';
import { z } from 'zod';

import type { WorkflowResult } from './comfyUIClientService';

const POLL_INTERVAL_MS = 2000;
const TRACKING_TIMEOUT_MS = 300_000;
const historySchema = z.record(
  z.string(),
  z.object({
    outputs: z.record(
      z.string(),
      z
        .object({
          images: z
            .array(z.object({ filename: z.string(), subfolder: z.string(), type: z.string() }))
            .optional(),
        })
        .passthrough(),
    ),
    status: z.object({
      completed: z.boolean(),
      messages: z.array(z.tuple([z.string(), z.record(z.string(), z.unknown())])),
      status_str: z.string(),
    }),
  }),
);

/** Submit once; socket loss affects progress, not the lifetime of the queued job. */
export async function executeComfyUIWorkflow(
  client: ComfyApi,
  workflow: PromptBuilder<string, string, NodeData>,
  onProgress?: (info: TProgress) => void,
): Promise<WorkflowResult> {
  const job = await client.appendPrompt(workflow.workflow).catch(async (error: unknown) => {
    if (error instanceof Response)
      throw new Error(`ComfyUI rejected the workflow (${error.status}): ${await error.text()}`);
    if (error instanceof Error) throw error;
    throw new Error(
      'Failed to submit ComfyUI workflow; submission will not be retried automatically.',
      {
        cause: error,
      },
    );
  });
  const promptId = job.prompt_id;

  return new Promise<WorkflowResult>((resolve, reject) => {
    let settled = false;
    let checking = false;
    let lastTransportError: unknown;
    let pollTimer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    const unsubscribe: (() => void)[] = [];
    const deadline = setTimeout(() => {
      fail(
        new Error(
          `Timed out tracking ComfyUI prompt ${promptId}. The job may still be running; check ComfyUI before retrying.`,
          { cause: lastTransportError },
        ),
      );
    }, TRACKING_TIMEOUT_MS);

    const cleanup = () => {
      settled = true;
      clearTimeout(deadline);
      clearTimeout(pollTimer);
      controller.abort();
      for (const off of unsubscribe) off();
    };
    const fail = (error: Error) => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const checkHistory = async () => {
      if (settled || checking) return;
      checking = true;
      clearTimeout(pollTimer);
      try {
        const response = await client.fetchApi(`/history/${encodeURIComponent(promptId)}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (settled) return;
        if (response.status === 401 || response.status === 403) {
          fail(
            new Error(`ComfyUI history access denied (${response.status}) for prompt ${promptId}`),
          );
          return;
        }
        if (!response.ok) throw new Error(`ComfyUI history request failed (${response.status})`);
        const parsed = historySchema.safeParse(await response.json());
        if (settled) return;
        if (!parsed.success) {
          fail(
            new Error(`Invalid ComfyUI history response for prompt ${promptId}`, {
              cause: parsed.error,
            }),
          );
          return;
        }
        const history = parsed.data[promptId];
        if (!history) return; // Queued/running jobs normally have no history entry yet.
        const failure = history.status.messages.find(
          ([event]) => event === 'execution_error' || event === 'execution_interrupted',
        );
        if (failure || history.status.status_str === 'error') {
          const message = failure?.[1].exception_message;
          fail(
            new Error(
              typeof message === 'string'
                ? message
                : `ComfyUI execution failed for prompt ${promptId}`,
            ),
          );
          return;
        }
        if (!history.status.completed) return;
        const result: WorkflowResult = { _raw: history.outputs };
        for (const [key, nodeId] of Object.entries(workflow.mapOutputKeys)) {
          if (!nodeId) continue;
          const output = history.outputs[nodeId];
          if (!output) {
            fail(new Error(`ComfyUI prompt ${promptId} completed without output node ${nodeId}`));
            return;
          }
          Object.assign(result, { [key]: output });
        }
        cleanup();
        resolve(result);
      } catch (error) {
        if (!settled) {
          if (lastTransportError === undefined)
            console.error('[ComfyUI] History tracking temporarily unavailable:', error);
          lastTransportError = error;
        }
      } finally {
        checking = false;
        if (!settled) pollTimer = setTimeout(() => void checkHistory(), POLL_INTERVAL_MS);
      }
    };

    unsubscribe.push(
      client.on('progress', (event) => {
        if (event.detail.prompt_id === promptId) onProgress?.(event.detail);
      }),
      client.on('execution_error', (event) => {
        if (event.detail.prompt_id === promptId) fail(new Error(event.detail.exception_message));
      }),
      client.on('execution_interrupted', (event) => {
        if (event.detail.prompt_id === promptId)
          fail(new Error(`ComfyUI execution interrupted for prompt ${promptId}`));
      }),
      client.on('execution_success', (event) => {
        if (event.detail.prompt_id === promptId) void checkHistory();
      }),
      client.on('disconnected', () => void checkHistory()),
      client.on('reconnected', () => void checkHistory()),
    );
    void checkHistory();
  });
}
