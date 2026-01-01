import { isEqual } from 'es-toolkit/compat';
import { useRef } from 'react';
import type { SWRResponse } from 'swr';
import { type StateCreator } from 'zustand';

import { mutate, useClientDataSWR } from '@/libs/swr';
import { type GetGenerationStatusResult } from '@/server/routers/lambda/generation';
import { generationService } from '@/services/generation';
import { generationBatchService } from '@/services/generationBatch';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type GenerationBatch } from '@/types/generation';
import { setNamespace } from '@/utils/storeDebug';

import { type ImageStore } from '../../store';
import { generationTopicSelectors } from '../generationTopic/selectors';
import { type GenerationBatchDispatch, generationBatchReducer } from './reducer';

const n = setNamespace('generationBatch');

// ====== SWR key ====== //
const SWR_USE_FETCH_GENERATION_BATCHES = 'SWR_USE_FETCH_GENERATION_BATCHES';
const SWR_USE_CHECK_GENERATION_STATUS = 'SWR_USE_CHECK_GENERATION_STATUS';

// ====== action interface ====== //

export interface GenerationBatchAction {
  setTopicBatchLoaded: (topicId: string) => void;
  internal_dispatchGenerationBatch: (
    topicId: string,
    payload: GenerationBatchDispatch,
    action?: string,
  ) => void;
  removeGeneration: (generationId: string) => Promise<void>;
  internal_deleteGeneration: (generationId: string) => Promise<void>;
  removeGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  internal_deleteGenerationBatch: (batchId: string, topicId: string) => Promise<void>;
  refreshGenerationBatches: () => Promise<void>;
  useCheckGenerationStatus: (
    generationId: string,
    asyncTaskId: string,
    topicId: string,
    enable?: boolean,
  ) => SWRResponse<GetGenerationStatusResult>;
  useFetchGenerationBatches: (topicId?: string | null) => SWRResponse<GenerationBatch[]>;
}

// ====== action implementation ====== //

export const createGenerationBatchSlice: StateCreator<
  ImageStore,
  [['zustand/devtools', never]],
  [],
  GenerationBatchAction
> = (set, get) => ({
  setTopicBatchLoaded: (topicId: string) => {
    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: [],
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      n('setTopicBatchLoaded'),
    );
  },

  removeGeneration: async (generationId: string) => {
    const { internal_deleteGeneration, activeGenerationTopicId, refreshGenerationBatches } = get();

    await internal_deleteGeneration(generationId);

    // 检查删除后是否有batch变成空的，如果有则删除空batch
    if (activeGenerationTopicId) {
      const updatedBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
      const emptyBatches = updatedBatches.filter((batch) => batch.generations.length === 0);

      // 删除所有空的batch
      for (const emptyBatch of emptyBatches) {
        await get().internal_deleteGenerationBatch(emptyBatch.id, activeGenerationTopicId);
      }

      // 如果删除了空batch，再次刷新数据确保一致性
      if (emptyBatches.length > 0) {
        await refreshGenerationBatches();
      }
    }
  },

  internal_deleteGeneration: async (generationId: string) => {
    const { activeGenerationTopicId, refreshGenerationBatches, internal_dispatchGenerationBatch } =
      get();

    if (!activeGenerationTopicId) return;

    // 找到包含该 generation 的 batch
    const currentBatches = get().generationBatchesMap[activeGenerationTopicId] || [];
    const targetBatch = currentBatches.find((batch) =>
      batch.generations.some((gen) => gen.id === generationId),
    );

    if (!targetBatch) return;

    // 1. 立即更新前端状态（乐观更新）
    internal_dispatchGenerationBatch(
      activeGenerationTopicId,
      { type: 'deleteGenerationInBatch', batchId: targetBatch.id, generationId },
      'internal_deleteGeneration',
    );

    // 2. 调用后端服务删除generation
    await generationService.deleteGeneration(generationId);

    // 3. 刷新数据确保一致性
    await refreshGenerationBatches();
  },

  removeGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_deleteGenerationBatch } = get();
    await internal_deleteGenerationBatch(batchId, topicId);
  },

  internal_deleteGenerationBatch: async (batchId: string, topicId: string) => {
    const { internal_dispatchGenerationBatch, refreshGenerationBatches } = get();

    // 1. 立即更新前端状态（乐观更新）
    internal_dispatchGenerationBatch(
      topicId,
      { type: 'deleteBatch', id: batchId },
      'internal_deleteGenerationBatch',
    );

    // 2. 调用后端服务
    await generationBatchService.deleteGenerationBatch(batchId);

    // 3. 刷新数据确保一致性
    await refreshGenerationBatches();
  },

  internal_dispatchGenerationBatch: (topicId, payload, action) => {
    const currentBatches = get().generationBatchesMap[topicId] || [];
    const nextBatches = generationBatchReducer(currentBatches, payload);

    const nextMap = {
      ...get().generationBatchesMap,
      [topicId]: nextBatches,
    };

    // no need to update map if the map is the same
    if (isEqual(nextMap, get().generationBatchesMap)) return;

    set(
      {
        generationBatchesMap: nextMap,
      },
      false,
      action ?? n(`dispatchGenerationBatch/${payload.type}`),
    );
  },

  refreshGenerationBatches: async () => {
    const { activeGenerationTopicId } = get();
    if (activeGenerationTopicId) {
      await mutate([SWR_USE_FETCH_GENERATION_BATCHES, activeGenerationTopicId]);
    }
  },

  useFetchGenerationBatches: (topicId) =>
    useClientDataSWR<GenerationBatch[]>(
      topicId ? [SWR_USE_FETCH_GENERATION_BATCHES, topicId] : null,
      async ([, topicId]: [string, string]) => {
        return generationBatchService.getGenerationBatches(topicId);
      },
      {
        onSuccess: (data) => {
          const nextMap = {
            ...get().generationBatchesMap,
            [topicId!]: data,
          };

          // no need to update map if the map is the same
          if (isEqual(nextMap, get().generationBatchesMap)) return;

          set(
            {
              generationBatchesMap: nextMap,
            },
            false,
            n('useFetchGenerationBatches(success)', { topicId }),
          );
        },
      },
    ),

  useCheckGenerationStatus: (generationId, asyncTaskId, topicId, enable = true) => {
    const requestCountRef = useRef(0);
    const isErrorRef = useRef(false);

    return useClientDataSWR<GetGenerationStatusResult>(
      enable && generationId && !generationId.startsWith('temp-') && asyncTaskId
        ? [SWR_USE_CHECK_GENERATION_STATUS, generationId, asyncTaskId]
        : null,
      async ([, generationId, asyncTaskId]: [string, string, string]) => {
        // 增加请求计数
        requestCountRef.current += 1;
        return generationService.getGenerationStatus(generationId, asyncTaskId);
      },
      {
        refreshWhenHidden: false,
        refreshInterval: (data: GetGenerationStatusResult | undefined) => {
          // 如果状态是 success 或 error，停止轮询
          if (data?.status === AsyncTaskStatus.Success || data?.status === AsyncTaskStatus.Error) {
            return 0; // 停止轮询
          }

          // 根据请求次数动态调整间隔：使用指数退避算法
          // 基础间隔 1 秒，最大间隔 30 秒
          const baseInterval = 1000;
          const maxInterval = 30_000;
          const currentCount = requestCountRef.current;

          // 指数退避：每 5 次请求后间隔翻倍
          const backoffMultiplier = Math.floor(currentCount / 5);
          let dynamicInterval = Math.min(
            baseInterval * Math.pow(2, backoffMultiplier),
            maxInterval,
          );

          // 如果之前有错误，使用更长的间隔（乘以 2）
          if (isErrorRef.current) {
            dynamicInterval = Math.min(dynamicInterval * 2, maxInterval);
          }

          return dynamicInterval;
        },
        onError: (error) => {
          // 发生错误时设置错误状态
          isErrorRef.current = true;
          console.error('Generation status check error:', error);
        },
        onSuccess: async (data: GetGenerationStatusResult) => {
          if (!data) return;

          // 成功时重置错误状态
          isErrorRef.current = false;

          // 找到对应的 batch，generation 数据库记录包含 generationBatchId
          const currentBatches = get().generationBatchesMap[topicId] || [];
          const targetBatch = currentBatches.find((batch) =>
            batch.generations.some((gen) => gen.id === generationId),
          );

          // 如果状态为成功或错误，都要更新对应的 generation
          if (
            (data.status === AsyncTaskStatus.Success || data.status === AsyncTaskStatus.Error) &&
            targetBatch
          ) {
            // 重置请求计数器，因为任务已完成
            requestCountRef.current = 0;

            if (data.generation) {
              // 更新 generation 数据
              get().internal_dispatchGenerationBatch(
                topicId,
                {
                  type: 'updateGenerationInBatch',
                  batchId: targetBatch.id,
                  generationId,
                  value: data.generation,
                },
                n(
                  `useCheckGenerationStatus/${data.status === AsyncTaskStatus.Success ? 'success' : 'error'}`,
                ),
              );

              // 如果生成成功且有缩略图，检查当前 topic 是否有 imageUrl
              if (data.status === AsyncTaskStatus.Success && data.generation.asset?.thumbnailUrl) {
                const currentTopic =
                  generationTopicSelectors.getGenerationTopicById(topicId)(get());

                // 如果当前 topic 没有 imageUrl，使用这个 generation 的 thumbnailUrl 更新
                if (currentTopic && !currentTopic.coverUrl) {
                  await get().updateGenerationTopicCover(
                    topicId,
                    data.generation.asset.thumbnailUrl,
                  );
                }
              }
            }

            // 在成功或失败后都要 refreshGenerationBatches
            await get().refreshGenerationBatches();
          }
        },
      },
    );
  },
});
