import { getMessageError } from '@lobechat/fetch-sse';

import { getBusinessTrpcHeaders } from '@/business/client/trpc-headers';
import { createHeaderWithAuth } from '@/services/_auth';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { type ChatModelCard } from '@/types/llm';

import { API_ENDPOINTS } from './_url';
import { resolveRuntimeProvider } from './chat/helper';
import { initializeWithClientStore } from './chat/mecha';
import { oneShotRelay } from './llmRelay';

const isEnableFetchOnClient = (provider: string) =>
  aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());

/**
 * Auth headers plus the business ones (the cloud build's `X-Workspace-Id`): the
 * server resolves the provider config — and whether to relay — per workspace.
 */
const createServerHeaders = async (provider: string) => ({
  ...((await createHeaderWithAuth({
    headers: { 'Content-Type': 'application/json' },
    provider,
  })) as Record<string, string>),
  ...(await getBusinessTrpcHeaders()),
});

// Progress information interface
export interface ModelProgressInfo {
  completed?: number;
  digest?: string;
  model?: string;
  status?: string;
  total?: number;
}

// Progress callback function type
export type ProgressCallback = (progress: ModelProgressInfo) => void;
export type ErrorCallback = (error: { message: string }) => void;

export class ModelsService {
  private _abortController: AbortController | null = null;

  getModels = async (provider: string): Promise<ChatModelCard[] | undefined> => {
    const headers = await createServerHeaders(provider);

    const runtimeProvider = resolveRuntimeProvider(provider);
    /**
     * A provider only this device reaches: within the LLM relay the server
     * lists its models through this tab (one-shot relay); outside it, the
     * legacy browser runtime asks the provider directly.
     */
    const enableFetchOnClient = isEnableFetchOnClient(provider);
    const relayToThisTab = enableFetchOnClient && oneShotRelay.needsRelay(provider);
    if (enableFetchOnClient && !relayToThisTab) {
      const agentRuntime = await initializeWithClientStore({
        provider,
        runtimeProvider,
      });
      return agentRuntime.models();
    }

    const res = await oneShotRelay.run(relayToThisTab ? provider : undefined, (relay) =>
      fetch(API_ENDPOINTS.models(provider), {
        headers: relay ? { ...headers, ...relay.headers } : headers,
      }),
    );
    if (!res.ok) {
      const error = await getMessageError(res);
      const message =
        typeof error.body?.message === 'string' && error.body.message
          ? error.body.message
          : error.message;

      throw new Error(message, { cause: error });
    }

    return res.json();
  };

  /**
   * Download model and return progress info through callback
   */
  downloadModel = async (
    { model, provider }: { model: string; provider: string },
    { onProgress }: { onError?: ErrorCallback; onProgress?: ProgressCallback } = {},
  ): Promise<void> => {
    try {
      this._abortController = new AbortController();
      const signal = this._abortController.signal;

      const headers = await createServerHeaders(provider);

      const runtimeProvider = resolveRuntimeProvider(provider);
      const enableFetchOnClient = isEnableFetchOnClient(provider);
      // Within the LLM relay the server downloads through this tab (see `getModels`).
      const relayToThisTab = enableFetchOnClient && oneShotRelay.needsRelay(provider);

      if (enableFetchOnClient && !relayToThisTab) {
        const agentRuntime = await initializeWithClientStore({
          provider,
          runtimeProvider,
        });
        const res = (await agentRuntime.pullModel({ model }, { signal }))!;
        if (!res.ok) throw await getMessageError(res);
        if (res.body) await this.processModelPullStream(res, { onProgress });
        return;
      }

      // The relay channel must stay open until the whole progress stream is read.
      await oneShotRelay.run(
        relayToThisTab ? provider : undefined,
        async (relay) => {
          const res = await fetch(API_ENDPOINTS.modelPull(provider), {
            body: JSON.stringify({ model }),
            headers: relay ? { ...headers, ...relay.headers } : headers,
            method: 'POST',
            signal,
          });

          if (!res.ok) throw await getMessageError(res);
          if (res.body) await this.processModelPullStream(res, { onProgress });
        },
        { signal },
      );
    } catch (error) {
      // If operation is canceled, no need to continue throwing error
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error('download model error:', error);
      throw error;
    } finally {
      this._abortController = null;
    }
  };

  abortPull = () => {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  };

  /**
   * Process model download stream, parse progress info and return via callback
   * @param response Response object
   * @param onProgress Progress callback function
   * @returns Promise<void>
   */
  private processModelPullStream = async (
    response: Response,
    { onProgress, onError }: { onError?: ErrorCallback; onProgress?: ProgressCallback },
  ): Promise<void> => {
    const reader = response.body?.getReader();
    if (!reader) return;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const progressText = new TextDecoder().decode(value);
      // One line may contain multiple progress updates
      const progressUpdates = progressText.trim().split('\n');

      for (const update of progressUpdates) {
        let progress;
        try {
          progress = JSON.parse(update);
        } catch (e) {
          console.error('Error parsing progress update:', e);
          console.error('raw data', update);
        }

        if (progress.status === 'canceled') {
          console.info('progress:', progress);
        }

        if (progress.status === 'error') {
          onError?.({ message: progress.error });
          throw new Error(progress.error);
        }

        if (progress.completed !== undefined || progress.status) {
          onProgress?.(progress);
        }
      }
    }
  };
}

export const modelsService = new ModelsService();
