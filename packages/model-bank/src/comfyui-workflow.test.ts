import { describe, expect, it } from 'vitest';

import type { ComfyUIWorkflow } from './comfyui-workflow';
import {
  ComfyUIWorkflowGraphSchema,
  ComfyUIWorkflowSchema,
  getComfyUIWorkflowParameters,
} from './comfyui-workflow';
import { CreateAiModelSchema, UpdateAiModelSchema } from './types/aiModel';

const workflow: ComfyUIWorkflow = {
  bindings: {
    imageUrls: [{ imageIndex: 1, input: 'image', nodeId: 'reference' }],
    negativePrompt: [{ input: 'text', nodeId: 'negative' }],
    prompt: [{ input: 'text', nodeId: 'positive' }],
    seed: [{ input: 'seed', nodeId: 'sampler' }],
  },
  graph: {
    negative: { class_type: 'Text', inputs: { text: 'saved negative' } },
    output: { class_type: 'SaveImage', inputs: { images: ['sampler', 0] } },
    positive: { class_type: 'Text', inputs: { text: 'saved positive' } },
    reference: { class_type: 'LoadImage', inputs: { image: 'saved.png' } },
    sampler: { class_type: 'CustomSampler', inputs: { cfg: 7, seed: 123, steps: 31 } },
  },
  output: { imageIndex: 2, nodeId: 'output' },
  version: 1,
};

function changedWorkflow() {
  return structuredClone(workflow);
}

describe('ComfyUI imported workflow contract', () => {
  it('preserves API graphs and explicit output selection without introducing unbound controls', () => {
    const saved = ComfyUIWorkflowSchema.parse(workflow);
    expect(saved).toEqual(workflow);
    expect(getComfyUIWorkflowParameters(saved)).toEqual({
      imageUrls: { default: [], maxCount: 2 },
      negativePrompt: { default: 'saved negative' },
      prompt: { default: 'saved positive' },
      seed: { default: null, max: 2 ** 31 - 1, min: 0 },
    });
    expect(saved.graph.sampler.inputs).toEqual({ cfg: 7, seed: 123, steps: 31 });
  });

  it('uses usable control ranges while retaining unusually large graph defaults', () => {
    const saved = changedWorkflow();
    saved.bindings.cfg = [{ input: 'cfg', nodeId: 'sampler' }];
    saved.bindings.steps = [{ input: 'steps', nodeId: 'sampler' }];
    saved.bindings.width = [{ input: 'width', nodeId: 'sampler' }];
    saved.graph.sampler.inputs.cfg = 50;
    saved.graph.sampler.inputs.steps = 300;
    saved.graph.sampler.inputs.width = 9000;
    const parameters = getComfyUIWorkflowParameters(saved);
    expect(parameters.cfg).toEqual({ default: 50, max: 50, min: 0, step: 0.1 });
    expect(parameters.steps).toEqual({ default: 300, max: 300, min: 1, step: 1 });
    expect(parameters.width).toEqual({ default: 9000, max: 9000, min: 1, step: 1 });
  });

  it('supports graphs with no bindings while keeping the common prompt contract', () => {
    expect(getComfyUIWorkflowParameters({ ...workflow, bindings: {} })).toEqual({
      prompt: { default: '' },
    });
  });

  it('accepts multiple targets for one parameter', () => {
    const saved = changedWorkflow();
    saved.bindings.prompt!.push({ input: 'text', nodeId: 'negative' });
    delete saved.bindings.negativePrompt;
    expect(ComfyUIWorkflowSchema.safeParse(saved).success).toBe(true);
  });

  it('rejects editor JSON instead of silently selecting a node', () => {
    expect(
      ComfyUIWorkflowGraphSchema.safeParse({ links: [], nodes: [{ id: 1, type: 'Text' }] }).success,
    ).toBe(false);
    expect(ComfyUIWorkflowSchema.safeParse({ ...workflow, output: undefined }).success).toBe(false);
  });

  it.each([
    [
      'missing binding node',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.prompt![0].nodeId = 'missing';
      },
    ],
    [
      'missing binding input',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.prompt![0].input = 'missing';
      },
    ],
    [
      'wrong binding literal type',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.prompt![0] = { input: 'seed', nodeId: 'sampler' };
      },
    ],
    [
      'duplicate binding',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.prompt!.push(saved.bindings.prompt![0]);
      },
    ],
    [
      'conflicting binding',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.negativePrompt = saved.bindings.prompt;
      },
    ],
    [
      'missing reference index',
      (saved: ComfyUIWorkflow) => {
        delete saved.bindings.imageUrls![0].imageIndex;
      },
    ],
    [
      'reference index on a prompt',
      (saved: ComfyUIWorkflow) => {
        saved.bindings.prompt![0].imageIndex = 0;
      },
    ],
    [
      'missing output node',
      (saved: ComfyUIWorkflow) => {
        saved.output.nodeId = 'missing';
      },
    ],
    [
      'negative output index',
      (saved: ComfyUIWorkflow) => {
        saved.output.imageIndex = -1;
      },
    ],
    [
      'missing connection node',
      (saved: ComfyUIWorkflow) => {
        saved.graph.output.inputs.images = ['missing', 0];
      },
    ],
    [
      'malformed connection',
      (saved: ComfyUIWorkflow) => {
        saved.graph.output.inputs.images = ['sampler', '0'];
      },
    ],
    [
      'negative connection slot',
      (saved: ComfyUIWorkflow) => {
        saved.graph.output.inputs.images = ['sampler', -1];
      },
    ],
    [
      'connection cycle',
      (saved: ComfyUIWorkflow) => {
        saved.graph.sampler.inputs.image = ['output', 0];
      },
    ],
    [
      'unsafe input key',
      (saved: ComfyUIWorkflow) => {
        Object.defineProperty(saved.graph.positive.inputs, 'constructor', {
          enumerable: true,
          value: 'unsafe',
        });
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const saved = changedWorkflow();
    mutate(saved);
    expect(ComfyUIWorkflowSchema.safeParse(saved).success).toBe(false);
  });

  it.each(['nested', 'input', 'node'])('rejects unsafe %s JSON keys', (location) => {
    const saved = changedWorkflow();
    const target = location === 'node' ? saved.graph : saved.graph.sampler.inputs;
    if (location === 'nested') {
      saved.graph.sampler.inputs.extra = JSON.parse('{"__proto__":{"polluted":true}}');
    } else {
      Object.defineProperty(target, '__proto__', { enumerable: true, value: {} });
    }
    expect(ComfyUIWorkflowSchema.safeParse(saved).success).toBe(false);
  });

  it('persists workflow and derived parameters through create and update without accepting chatConfig', () => {
    const parameters = getComfyUIWorkflowParameters(workflow);
    const config = {
      chatConfig: { effort: 'high' },
      comfyuiWorkflow: workflow,
      deploymentName: 'kept',
    };
    const expected = { comfyuiWorkflow: workflow, deploymentName: 'kept' };
    expect(
      CreateAiModelSchema.parse({
        config,
        id: 'comfyui/workflow-test',
        parameters,
        providerId: 'comfyui',
        type: 'image',
      }),
    ).toEqual({
      config: expected,
      id: 'comfyui/workflow-test',
      parameters: expect.objectContaining(parameters),
      providerId: 'comfyui',
      type: 'image',
    });
    expect(UpdateAiModelSchema.parse({ config, parameters })).toEqual({
      config: expected,
      parameters: expect.objectContaining(parameters),
    });
    expect(
      CreateAiModelSchema.safeParse({
        config: { comfyuiWorkflow: { ...workflow, graph: {} } },
        id: 'bad',
        providerId: 'comfyui',
      }).success,
    ).toBe(false);
  });
});
