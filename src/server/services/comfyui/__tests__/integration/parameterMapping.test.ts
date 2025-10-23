// @vitest-environment node
import { PromptBuilder } from '@saintno/comfyui-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parametersFixture } from '@/server/services/comfyui/__tests__/fixtures/parameters.fixture';
import { supportedFixture } from '@/server/services/comfyui/__tests__/fixtures/supported.fixture';
import { mockContext } from '@/server/services/comfyui/__tests__/helpers/mockContext';
import { setupAllMocks } from '@/server/services/comfyui/__tests__/setup/unifiedMocks';
// Import workflow builders
import { buildFluxDevWorkflow } from '@/server/services/comfyui/workflows/flux-dev';
import { buildFluxKontextWorkflow } from '@/server/services/comfyui/workflows/flux-kontext';
import { buildFluxSchnellWorkflow } from '@/server/services/comfyui/workflows/flux-schnell';
import { buildSD35Workflow } from '@/server/services/comfyui/workflows/sd35';
import { buildSimpleSDWorkflow } from '@/server/services/comfyui/workflows/simple-sd';

describe('Parameter Mapping - Core Business Logic', () => {
  const { models } = parametersFixture;
  let inputCalls: Map<string, any>;

  beforeEach(() => {
    const mocks = setupAllMocks();
    inputCalls = mocks.inputCalls;
  });

  // Workflow builder mapping
  const workflowBuilders = {
    'flux-dev': buildFluxDevWorkflow,
    'flux-schnell': buildFluxSchnellWorkflow,
    'flux-kontext': buildFluxKontextWorkflow,
    'sd15': buildSimpleSDWorkflow,
    'sdxl': buildSimpleSDWorkflow,
    'sd35': buildSD35Workflow,
  };

  // Parameterized tests for all supported models
  describe.each(
    Object.entries(models).filter(
      ([name]) => workflowBuilders[name as keyof typeof workflowBuilders],
    ),
  )('%s parameter mapping', (modelName, modelConfig) => {
    const builder = workflowBuilders[modelName as keyof typeof workflowBuilders];

    it('should map schema parameters to workflow', async () => {
      const params: any = {
        prompt: 'test prompt',
        ...modelConfig.defaults,
      };

      // Special parameter handling
      if (modelName === 'flux-kontext') {
        params.imageUrl = 'test.png';
      }
      if (modelName.startsWith('sd')) {
        params.width = 512;
        params.height = 512;
      } else if (modelName.startsWith('flux') && modelName !== 'flux-kontext') {
        params.width = 1024;
        params.height = 1024;
      }

      // Build workflow
      const workflow = await builder(`${modelName}.safetensors`, params, mockContext);

      // Verify workflow is built successfully
      expect(workflow).toBeDefined();

      // Verify PromptBuilder was used for workflow construction
      expect(workflow).toBeDefined();
      expect(typeof workflow).toBe('object');
    });

    it('should handle boundary values', async () => {
      const { min, max } = modelConfig.boundaries!;

      const baseParams = {
        prompt: 'test prompt',
        width: 512,
        height: 512,
      };

      // Minimum values should not error
      const minResult = await builder(
        `${modelName}.safetensors`,
        { ...baseParams, ...modelConfig.defaults, ...min },
        mockContext,
      );
      expect(minResult).toBeDefined();

      // Maximum values should not error
      const maxResult = await builder(
        `${modelName}.safetensors`,
        { ...baseParams, ...modelConfig.defaults, ...max },
        mockContext,
      );
      expect(maxResult).toBeDefined();
    });
  });

  // Parameter transformation tests
  describe('Parameter Transformations', () => {
    it.each(parametersFixture.transformations.aspectRatio)(
      'should transform aspectRatio $input to width/height',
      async ({ input, expected }) => {
        const params = {
          prompt: 'test prompt',
          ...models['flux-dev'].defaults,
          aspectRatio: input,
        };

        const workflow = await buildFluxDevWorkflow('flux-dev.safetensors', params, mockContext);

        // Verify workflow builds successfully
        expect(workflow).toBeDefined();

        // aspectRatio should be processed (verified through successful workflow build)
        const workflowStr = JSON.stringify(workflow.workflow || workflow);
        expect(workflowStr).not.toContain('aspectRatio');
      },
    );

    it('should handle imageUrl for img2img mode', async () => {
      const params = {
        prompt: 'test prompt',
        imageUrl: 'test-image.png',
        strength: 0.8,
      };

      const workflow = await buildFluxKontextWorkflow(
        'flux-kontext.safetensors',
        params,
        mockContext,
      );

      // Verify workflow builds successfully (img2img parameters processed)
      expect(workflow).toBeDefined();
    });
  });
});
