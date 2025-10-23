import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import real test data
import {
  TEST_COMPONENTS,
  TEST_MODELS,
} from '@/server/services/comfyui/__tests__/helpers/realConfigData';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ModelResolverService } from '@/server/services/comfyui/core/modelResolverService';
import {
  WorkflowBuilderService,
  WorkflowContext,
} from '@/server/services/comfyui/core/workflowBuilderService';
import { WorkflowError } from '@/server/services/comfyui/errors';

// Mock dependencies (must be before other imports)
vi.mock('@/server/services/comfyui/core/comfyUIClientService');
vi.mock('@/server/services/comfyui/core/modelResolverService');

// No need to mock modelRegistry - we want to use the real implementation

describe('WorkflowBuilderService', () => {
  let service: WorkflowBuilderService;
  let mockContext: WorkflowContext;
  let mockModelResolver: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockModelResolver = {
      getAvailableVAEFiles: vi.fn().mockResolvedValue(['sdxl_vae.safetensors']),
      getOptimalComponent: vi.fn(),
    };

    mockContext = {
      clientService: {} as ComfyUIClientService,
      modelResolverService: mockModelResolver as ModelResolverService,
    };

    service = new WorkflowBuilderService(mockContext);
  });

  describe('buildWorkflow', () => {
    it('should build FLUX workflow', async () => {
      // Mock component resolution with real component names
      mockModelResolver.getOptimalComponent
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.t5) // First call for t5
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.clip); // Second call for clip

      const workflow = await service.buildWorkflow(
        'flux-1-dev',
        { architecture: 'FLUX', isSupported: true },
        TEST_MODELS.flux,
        {
          cfg: 3.5,
          height: 1024,
          prompt: 'A beautiful landscape',
          steps: 20,
          width: 1024,
        },
      );

      expect(workflow).toBeDefined();
      expect(workflow.workflow).toBeDefined();
      // Verify component resolution was called
      expect(mockModelResolver.getOptimalComponent).toHaveBeenCalled();
    });

    it('should build SD/SDXL workflow with VAE', async () => {
      mockModelResolver.getOptimalComponent.mockResolvedValue(TEST_COMPONENTS.sd.vae);

      const workflow = await service.buildWorkflow(
        'stable-diffusion-xl',
        { architecture: 'SDXL', isSupported: true },
        TEST_MODELS.sdxl,
        {
          cfg: 7,
          height: 1024,
          negativePrompt: 'blurry, ugly',
          prompt: 'A beautiful landscape',
          steps: 20,
          width: 1024,
        },
      );

      expect(workflow).toBeDefined();
      expect(workflow.workflow).toBeDefined();

      // Check if VAE loader was added
      const nodes = workflow.workflow as any;
      const vaeNode = Object.values(nodes).find((node: any) => node.class_type === 'VAELoader');
      expect(vaeNode).toBeDefined();
    });

    it('should build SD3.5 workflow', async () => {
      mockModelResolver.getOptimalComponent
        .mockResolvedValueOnce(TEST_COMPONENTS.sd.clip) // clip_g
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.clip) // clip_l (reuse from FLUX)
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.t5); // t5xxl (reuse from FLUX)

      const workflow = await service.buildWorkflow(
        'stable-diffusion-35',
        { architecture: 'SD3', isSupported: true, variant: 'sd35' },
        TEST_MODELS.sd35,
        {
          cfg: 4.5,
          height: 1024,
          prompt: 'A futuristic city',
          shift: 3,
          steps: 28,
          width: 1024,
        },
      );

      expect(workflow).toBeDefined();
      expect(workflow.workflow).toBeDefined();

      // Check for SD3.5 specific nodes
      const nodes = workflow.workflow as any;
      const samplingNode = Object.values(nodes).find(
        (node: any) => node.class_type === 'ModelSamplingSD3',
      );
      expect(samplingNode).toBeDefined();
    });

    it('should throw error for unsupported model type', async () => {
      await expect(
        service.buildWorkflow(
          'unknown-model',
          { architecture: 'UNKNOWN' as any, isSupported: false },
          'unknown.safetensors',
          {},
        ),
      ).rejects.toThrow(WorkflowError);
    });
  });

  describe('FLUX workflow specifics', () => {
    it('should throw error when required components not found', async () => {
      // Mock component resolution to fail - should throw error (not use defaults)
      mockModelResolver.getOptimalComponent.mockRejectedValue(
        new Error('Required CLIP component not found'),
      );

      // Should throw error because required components are missing
      await expect(
        service.buildWorkflow(
          'flux-1-dev',
          { architecture: 'FLUX', isSupported: true },
          TEST_MODELS.flux,
          { prompt: 'test' },
        ),
      ).rejects.toThrow('Required CLIP component not found');
    });

    it('should use default parameters when not provided', async () => {
      // Mock component resolution with real components
      mockModelResolver.getOptimalComponent
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.t5)
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.clip);

      const workflow = await service.buildWorkflow(
        'flux-1-dev',
        { architecture: 'FLUX', isSupported: true },
        TEST_MODELS.flux,
        { prompt: 'test' },
      );

      // The workflow should be built with default params
      expect(workflow).toBeDefined();
      // Verify component resolution was called
      expect(mockModelResolver.getOptimalComponent).toHaveBeenCalled();
    });
  });

  describe('SD/SDXL workflow specifics', () => {
    it('should build workflow with VAE loader when external VAE specified', async () => {
      // For SDXL, the workflow will use sdxl_vae.safetensors from getOptimalVAEForModel
      mockModelResolver.getOptimalComponent.mockResolvedValue('sdxl_vae.safetensors');

      const workflow = await service.buildWorkflow(
        'stable-diffusion-xl',
        { architecture: 'SDXL', isSupported: true },
        TEST_MODELS.sdxl,
        { prompt: 'test' },
      );

      const nodes = workflow.workflow as any;
      const vaeLoader = Object.values(nodes).find((node: any) => node.class_type === 'VAELoader');

      // Should have VAE loader with the priority 1 SDXL VAE from config
      expect(vaeLoader).toBeDefined();
      expect((vaeLoader as any).inputs.vae_name).toBe('sdxl_vae.safetensors');
    });

    it('should support custom sampler and scheduler', async () => {
      mockModelResolver.getOptimalComponent.mockResolvedValue(undefined);

      const workflow = await service.buildWorkflow(
        'stable-diffusion-xl',
        { architecture: 'SDXL', isSupported: true },
        TEST_MODELS.sdxl,
        {
          prompt: 'test',
          samplerName: 'dpmpp_2m',
          scheduler: 'karras',
        },
      );

      const nodes = workflow.workflow as any;
      const samplerNode = Object.values(nodes).find(
        (node: any) => node.class_type === 'KSampler',
      ) as any;

      expect(samplerNode.inputs.sampler_name).toBe('dpmpp_2m');
      expect(samplerNode.inputs.scheduler).toBe('karras');
    });
  });

  describe('SD3.5 workflow specifics', () => {
    it('should use Triple CLIP loader when components available', async () => {
      mockModelResolver.getOptimalComponent
        .mockResolvedValueOnce(TEST_COMPONENTS.sd.clip) // clip_g
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.clip) // clip_l
        .mockResolvedValueOnce(TEST_COMPONENTS.flux.t5); // t5xxl

      const workflow = await service.buildWorkflow(
        'stable-diffusion-35',
        { architecture: 'SD3', isSupported: true, variant: 'sd35' },
        TEST_MODELS.sd35,
        { prompt: 'test' },
      );

      const nodes = workflow.workflow as any;
      const tripleClipNode = Object.values(nodes).find(
        (node: any) => node.class_type === 'TripleCLIPLoader',
      );

      expect(tripleClipNode).toBeDefined();
    });

    it('should throw error when components not available', async () => {
      // Mock no components available
      mockModelResolver.getOptimalComponent.mockResolvedValue(undefined);

      await expect(
        service.buildWorkflow(
          'stable-diffusion-35',
          { architecture: 'SD3', isSupported: true, variant: 'sd35' },
          TEST_MODELS.sd35,
          { prompt: 'test' },
        ),
      ).rejects.toThrow(WorkflowError);

      await expect(
        service.buildWorkflow(
          'stable-diffusion-35',
          { architecture: 'SD3', isSupported: true, variant: 'sd35' },
          TEST_MODELS.sd35,
          { prompt: 'test' },
        ),
      ).rejects.toThrow('SD3.5 models require external CLIP/T5 encoder files');
    });

    it('should use default shift parameter', async () => {
      // Mock components available for this test
      let callCount = 0;
      mockModelResolver.getOptimalComponent.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve('clip_l.safetensors');
        if (callCount === 2) return Promise.resolve('clip_g.safetensors');
        return Promise.resolve('t5xxl_fp16.safetensors');
      });

      const workflow = await service.buildWorkflow(
        'stable-diffusion-35',
        { architecture: 'SD3', isSupported: true, variant: 'sd35' },
        TEST_MODELS.sd35,
        {
          cfg: 4.5,
          prompt: 'test',
          steps: 28,
        },
      );

      const nodes = workflow.workflow as any;
      const samplingNode = Object.values(nodes).find(
        (node: any) => node.class_type === 'ModelSamplingSD3',
      ) as any;

      expect(samplingNode.inputs.shift).toBe(3); // Uses default from WORKFLOW_DEFAULTS.SD3.SHIFT
    });
  });
});
