// @vitest-environment node
import { vi } from 'vitest';

// Common mock setup for ComfyUI tests
export function setupComfyUIMocks() {
  // Mock the ComfyUI SDK - keep it simple, tests will override
  vi.mock('@saintno/comfyui-sdk', () => ({
    CallWrapper: vi.fn(),
    ComfyApi: vi.fn(),
    PromptBuilder: vi.fn(),
  }));

  // Mock the ModelResolver
  vi.mock('../utils/modelResolver', () => ({
    ModelResolver: vi.fn(),
    getAllModels: vi.fn().mockReturnValue(['flux-schnell.safetensors', 'flux-dev.safetensors']),
    isValidModel: vi.fn().mockReturnValue(true),
    resolveModel: vi.fn().mockImplementation(() => {
      return {
        modelFamily: 'FLUX',
        priority: 1,
        recommendedDtype: 'default' as const,
        variant: 'dev' as const,
      };
    }),
    resolveModelStrict: vi.fn().mockImplementation(() => {
      return {
        modelFamily: 'FLUX',
        priority: 1,
        recommendedDtype: 'default' as const,
        variant: 'dev' as const,
      };
    }),
  }));

  // Mock fetch globally
  global.fetch = vi.fn();

  // Mock console.error to avoid polluting test output
  vi.spyOn(console, 'error').mockImplementation(() => {});

  // Mock WorkflowDetector
  vi.mock('../utils/workflowDetector', () => ({
    WorkflowDetector: {
      detectModelType: vi.fn(),
    },
  }));

  // Mock processModels utility
  vi.mock('../utils/modelParse', () => ({
    MODEL_LIST_CONFIGS: {
      comfyui: {
        id: 'comfyui',
        modelList: [],
      },
    },
    detectModelProvider: vi.fn().mockImplementation((modelId: string) => {
      if (modelId.includes('claude')) return 'anthropic';
      if (modelId.includes('gpt')) return 'openai';
      if (modelId.includes('gemini')) return 'google';
      return 'unknown';
    }),
    processModelList: vi.fn(),
  }));
}

export function createMockComfyApi() {
  return {
    fetchApi: vi.fn().mockResolvedValue({
      CheckpointLoaderSimple: {
        input: {
          required: {
            ckpt_name: [['flux-schnell.safetensors', 'flux-dev.safetensors', 'sd15-base.ckpt']],
          },
        },
      },
    }),
    getPathImage: vi.fn().mockReturnValue('http://localhost:8000/view?filename=test.png'),
    init: vi.fn(),
    waitForReady: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockCallWrapper() {
  return {
    onFailed: vi.fn().mockReturnThis(),
    onFinished: vi.fn().mockReturnThis(),
    onProgress: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnThis(),
  };
}

export function createMockPromptBuilder() {
  return {
    input: vi.fn().mockReturnThis(),
    prompt: {},
    setInputNode: vi.fn().mockReturnThis(),
    setOutputNode: vi.fn().mockReturnThis(),
  } as any;
}

export function createMockModelResolver() {
  return {
    getAvailableModelFiles: vi
      .fn()
      .mockResolvedValue(['flux-schnell.safetensors', 'flux-dev.safetensors', 'sd15-base.ckpt']),
    resolveModelFileName: vi.fn().mockImplementation((modelId: string) => {
      if (
        modelId.includes('non-existent') ||
        modelId.includes('unknown') ||
        modelId.includes('non-verified')
      ) {
        return Promise.reject(new Error(`Model not found: ${modelId}`));
      }
      const fileName = modelId.split('/').pop() || modelId;
      return Promise.resolve(fileName + '.safetensors');
    }),
    transformModelFilesToList: vi.fn().mockReturnValue([]),
    validateModel: vi.fn().mockImplementation((modelId: string) => {
      if (
        modelId.includes('non-existent') ||
        modelId.includes('unknown') ||
        modelId.includes('non-verified')
      ) {
        return Promise.resolve({ exists: false });
      }
      const fileName = modelId.split('/').pop() || modelId;
      return Promise.resolve({ actualFileName: fileName + '.safetensors', exists: true });
    }),
  };
}

// Mock workflow builders
export function setupWorkflowMocks() {
  const createMockBuilder = () => ({
    input: vi.fn().mockReturnThis(),
    prompt: {
      '1': {
        _meta: { title: 'Checkpoint Loader' },
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'test.safetensors' },
      },
    },
    setInputNode: vi.fn().mockReturnThis(),
    setOutputNode: vi.fn().mockReturnThis(),
  });

  // Mock the workflows index
  vi.mock('../../workflows', () => ({
    buildFluxDevWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
    buildFluxKontextWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
    buildFluxKreaWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
    buildFluxSchnellWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
    buildSD35NoClipWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
    buildSD35Workflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  // Mock individual workflow builders
  vi.mock('../../workflows/flux-schnell', () => ({
    buildFluxSchnellWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  vi.mock('../../workflows/flux-dev', () => ({
    buildFluxDevWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  vi.mock('../../workflows/flux-kontext', () => ({
    buildFluxKontextWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  vi.mock('../../workflows/sd35', () => ({
    buildSD35Workflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  vi.mock('../../workflows/simple-sd', () => ({
    buildSimpleSDWorkflow: vi.fn().mockImplementation(() => createMockBuilder()),
  }));

  // Mock WorkflowRouter
  vi.mock('../utils/workflowRouter', () => {
    class WorkflowRoutingError extends Error {
      constructor(message?: string) {
        super(message);
        this.name = 'WorkflowRoutingError';
      }
    }

    return {
      WorkflowRouter: {
        getExactlySupportedModels: () => ['comfyui/flux-dev', 'comfyui/flux-schnell'],
        getSupportedFluxVariants: () => ['dev', 'schnell', 'kontext', 'krea'],
        routeWorkflow: () => createMockBuilder(),
      },
      WorkflowRoutingError,
    };
  });

  // Mock systemComponents
  vi.mock('../../config/systemComponents', () => ({
    getAllComponentsWithNames: vi.fn().mockImplementation((options: any) => {
      if (options?.type === 'clip') {
        return [
          { config: { priority: 1 }, name: 'clip_l.safetensors' },
          { config: { priority: 2 }, name: 'clip_g.safetensors' },
        ];
      }
      if (options?.type === 't5') {
        return [{ config: { priority: 1 }, name: 't5xxl_fp16.safetensors' }];
      }
      return [];
    }),
    getOptimalComponent: vi.fn().mockImplementation((type: string) => {
      if (type === 't5') return 't5xxl_fp16.safetensors';
      if (type === 'vae') return 'ae.safetensors';
      if (type === 'clip') return 'clip_l.safetensors';
      return 'default.safetensors';
    }),
  }));
}
