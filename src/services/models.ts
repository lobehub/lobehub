import { getMessageError } from '@lobechat/fetch-sse';

import { isDeprecatedEdition } from '@/const/version';
import { createHeaderWithAuth } from '@/services/_auth';
import { aiProviderSelectors, getAiInfraStoreState } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { modelConfigSelectors } from '@/store/user/selectors';
import { ChatModelCard } from '@/types/llm';

import { API_ENDPOINTS } from './_url';
import { initializeWithClientStore } from './chat/clientModelRuntime';
import { resolveRuntimeProvider } from './chat/helper';

const isEnableFetchOnClient = (provider: string) => {
  // TODO: remove this condition in V2.0
  if (isDeprecatedEdition) {
    return modelConfigSelectors.isProviderFetchOnClient(provider)(useUserStore.getState());
  } else {
    return aiProviderSelectors.isProviderFetchOnClient(provider)(getAiInfraStoreState());
  }
};

// 进度信息接口
export interface ModelProgressInfo {
  completed?: number;
  digest?: string;
  model?: string;
  status?: string;
  total?: number;
}

// 进度回调函数类型
export type ProgressCallback = (progress: ModelProgressInfo) => void;
export type ErrorCallback = (error: { message: string }) => void;

export class ModelsService {
  // 用于中断下载的控制器
  private _abortController: AbortController | null = null;

  // 获取模型列表
  getModels = async (provider: string): Promise<ChatModelCard[] | undefined> => {
    const headers = await createHeaderWithAuth({
      headers: { 'Content-Type': 'application/json' },
      provider,
    });

    const runtimeProvider = resolveRuntimeProvider(provider);
    try {
      /**
       * Use browser agent runtime
       */
      const enableFetchOnClient = isEnableFetchOnClient(provider);
      if (enableFetchOnClient) {
        const agentRuntime = await initializeWithClientStore({
          provider,
          runtimeProvider,
        });
        return agentRuntime.models();
      }

      const res = await fetch(API_ENDPOINTS.models(runtimeProvider), { headers });
      if (!res.ok) return;

      return res.json();
    } catch {
      return;
    }
  };

  /**
   * 下载模型并通过回调函数返回进度信息
   */
  downloadModel = async (
    { model, provider }: { model: string; provider: string },
    { onProgress }: { onError?: ErrorCallback; onProgress?: ProgressCallback } = {},
  ): Promise<void> => {
    try {
      // 创建一个新的 AbortController
      this._abortController = new AbortController();
      const signal = this._abortController.signal;

      const headers = await createHeaderWithAuth({
        headers: { 'Content-Type': 'application/json' },
        provider,
      });

      const runtimeProvider = resolveRuntimeProvider(provider);
      const enableFetchOnClient = isEnableFetchOnClient(provider);

      console.log('enableFetchOnClient：', enableFetchOnClient);
      let res: Response;
      if (enableFetchOnClient) {
        const agentRuntime = await initializeWithClientStore({
          provider,
          runtimeProvider,
        });
        res = (await agentRuntime.pullModel({ model }, { signal }))!;
      } else {
        res = await fetch(API_ENDPOINTS.modelPull(runtimeProvider), {
          body: JSON.stringify({ model }),
          headers,
          method: 'POST',
          signal,
        });
      }

      if (!res.ok) {
        throw await getMessageError(res);
      }

      // 处理响应流
      if (res.body) {
        await this.processModelPullStream(res, { onProgress });
      }
    } catch (error) {
      // 如果是取消操作，不需要继续抛出错误
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      console.error('download model error:', error);
      throw error;
    } finally {
      // 清理 AbortController
      this._abortController = null;
    }
  };

  // 中断模型下载
  abortPull = () => {
    // 使用 AbortController 中断下载
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  };

  /**
   * 处理模型下载流，解析进度信息并通过回调函数返回
   * @param response 响应对象
   * @param onProgress 进度回调函数
   * @returns Promise<void>
   */
  private processModelPullStream = async (
    response: Response,
    { onProgress, onError }: { onError?: ErrorCallback; onProgress?: ProgressCallback },
  ): Promise<void> => {
    // 处理响应流
    const reader = response.body?.getReader();
    if (!reader) return;

    // 读取和处理流数据
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 解析进度数据
      const progressText = new TextDecoder().decode(value);
      // 一行可能包含多个进度更新
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
          console.log('progress：', progress);
          // const abortError = new Error('abort');
          // abortError.name = 'AbortError';
          //
          // throw abortError;
        }

        if (progress.status === 'error') {
          onError?.({ message: progress.error });
          throw new Error(progress.error);
        }

        // 调用进度回调
        if (progress.completed !== undefined || progress.status) {
          onProgress?.(progress);
        }
      }
    }
  };
}

export const modelsService = new ModelsService();
