import { vi } from 'vitest';

import {
  TEST_COMPONENTS,
  TEST_FLUX_MODELS,
} from '@/server/services/comfyui/__tests__/fixtures/testModels';
import { type WorkflowContext } from '@/server/services/comfyui/core/workflowBuilderService';

/**
 * Create a mock WorkflowContext for testing
 * 创建测试用的模拟 WorkflowContext
 */
export function createMockContext(): WorkflowContext {
  return {
    clientService: {
      executeWorkflow: vi.fn().mockResolvedValue({ images: { images: [] } }),
      // New SDK wrapper methods
      getCheckpoints: vi.fn().mockResolvedValue([TEST_FLUX_MODELS.DEV, TEST_FLUX_MODELS.SCHNELL]),
      getLoras: vi.fn().mockResolvedValue(['lora1.safetensors', 'lora2.safetensors']),
      getNodeDefs: vi.fn().mockResolvedValue({
        CLIPLoader: {
          input: {
            required: {
              clip_name: [['clip_l.safetensors', 'clip_g.safetensors']],
            },
          },
        },
        DualCLIPLoader: {
          input: {
            required: {
              clip_name1: [['t5-v1_1-xxl-encoder.safetensors', 't5xxl_fp16.safetensors']],
            },
          },
        },
        VAELoader: {
          input: {
            required: {
              vae_name: [
                [
                  'ae.safetensors',
                  'sdxl_vae_fp16fix.safetensors',
                  'vae-ft-mse-840000-ema-pruned.safetensors',
                ],
              ],
            },
          },
        },
      }),
      getObjectInfo: vi.fn().mockResolvedValue({}),
      getPathImage: vi.fn().mockReturnValue('http://example.com/image.png'),
      getSamplerInfo: vi.fn().mockResolvedValue({
        sampler: ['euler', 'ddim', 'dpm_2'],
        scheduler: ['normal', 'karras', 'exponential'],
      }),
      validateConnection: vi.fn().mockResolvedValue(undefined),
    },
    modelResolverService: {
      // 新的服务层方法
      getOptimalComponent: vi.fn().mockImplementation((type: string, modelFamily: string) => {
        // 根据不同的组件类型和模型家族返回相应的默认值
        if (type === 't5') {
          return Promise.resolve(TEST_COMPONENTS.FLUX.T5);
        }
        if (type === 'vae') {
          if (modelFamily === 'FLUX') {
            return Promise.resolve(TEST_COMPONENTS.FLUX.VAE);
          }
          return Promise.resolve(TEST_COMPONENTS.SD.VAE);
        }
        if (type === 'clip') {
          if (modelFamily === 'FLUX') {
            return Promise.resolve(TEST_COMPONENTS.FLUX.CLIP_L);
          }
          return Promise.resolve(TEST_COMPONENTS.SD.CLIP_G);
        }
        return Promise.resolve(null);
      }),

      // 保留旧方法以兼容
      selectComponents: vi.fn().mockResolvedValue({
        clip: [TEST_COMPONENTS.FLUX.T5, TEST_COMPONENTS.FLUX.CLIP_L],
        t5: TEST_COMPONENTS.FLUX.T5,
        vae: TEST_COMPONENTS.FLUX.VAE,
      }),

      validateModel: vi.fn().mockResolvedValue({
        actualFileName: TEST_FLUX_MODELS.DEV,
        exists: true,
      }),
    } as any,
  } as unknown as WorkflowContext;
}

/**
 * Default mock context instance
 * 默认的模拟上下文实例
 */
export const mockContext = createMockContext();
