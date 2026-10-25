import type { ImageInfo, NodeDef, NodeDefsResponse, PromptBuilder } from '@saintno/comfyui-sdk';
import type { ComfyUIWorkflow } from 'model-bank';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';
import { ImportedWorkflowService } from '@/server/services/comfyui/core/importedWorkflowService';
import { validateComfyUIWorkflow } from '@/server/services/comfyui/core/workflowValidationService';

function definition(
  required: NodeDef['input']['required'],
  output: string[],
  outputNode = false,
): NodeDef {
  return {
    category: 'test',
    description: '',
    display_name: 'test',
    input: { hidden: {}, required },
    input_order: { hidden: [], required: Object.keys(required) },
    name: 'test',
    output,
    output_is_list: output.map(() => false),
    output_name: output,
    output_node: outputNode,
    output_tooltips: [],
    python_module: 'test',
  };
}

const definitions: NodeDefsResponse = {
  CustomSampler: definition(
    {
      cfg: ['FLOAT', { default: 8, max: 100, min: 0 }],
      height: ['INT', { default: 480, max: 4096, min: 1 }],
      imageA: ['IMAGE', {}],
      imageB: ['IMAGE', {}],
      model: ['MODEL', {}],
      negative: ['STRING', {}],
      positive: ['STRING', {}],
      sampler_name: [['custom-sampler', 'euler'], {}],
      scheduler: [['normal'], {}],
      seed: ['INT', { default: 456, max: 2 ** 31 - 1, min: 0 }],
      seedAlt: ['INT', { default: 456, max: 2 ** 31 - 1, min: 0 }],
      steps: ['INT', { default: 27, max: 1000, min: 1 }],
      width: ['INT', { default: 640, max: 4096, min: 1 }],
    },
    ['IMAGE'],
  ),
  GGUFLoader: definition({ model_name: [['anime.gguf'], {}] }, ['MODEL']),
  LoadImage: definition({ image: [['server-existing.png'], {}] }, ['IMAGE']),
  SaveImage: definition({ filename_prefix: ['STRING', {}], images: ['IMAGE', {}] }, [], true),
  Text: definition({ text: ['STRING', {}] }, ['STRING']),
};

const savedWorkflow: ComfyUIWorkflow = {
  bindings: {
    imageUrls: [
      { imageIndex: 0, input: 'image', nodeId: 'imageA' },
      { imageIndex: 1, input: 'image', nodeId: 'imageB' },
    ],
    prompt: [
      { input: 'text', nodeId: 'textA' },
      { input: 'text', nodeId: 'textB' },
    ],
    seed: [
      { input: 'seed', nodeId: 'sampler' },
      { input: 'seedAlt', nodeId: 'sampler' },
    ],
  },
  graph: {
    imageA: { class_type: 'LoadImage', inputs: { image: 'reference-a.png' } },
    imageB: { class_type: 'LoadImage', inputs: { image: 'reference-b.png' } },
    loader: { class_type: 'GGUFLoader', inputs: { model_name: 'anime.gguf' } },
    otherOutput: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'other', images: ['sampler', 0] },
    },
    output: {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'author-prefix', images: ['sampler', 0] },
    },
    sampler: {
      class_type: 'CustomSampler',
      inputs: {
        cfg: 8,
        height: 480,
        imageA: ['imageA', 0],
        imageB: ['imageB', 0],
        model: ['loader', 0],
        negative: 'author-negative',
        positive: ['textA', 0],
        sampler_name: 'custom-sampler',
        scheduler: 'normal',
        seed: 456,
        seedAlt: 456,
        steps: 27,
        width: 640,
      },
    },
    textA: { class_type: 'Text', inputs: { text: 'author-prompt-a' } },
    textB: { class_type: 'Text', inputs: { text: 'author-prompt-b' } },
  },
  output: { imageIndex: 1, nodeId: 'output' },
  version: 1,
};

const firstImage: ImageInfo = { filename: 'first.png', subfolder: '', type: 'output' };
const selectedImage: ImageInfo = { filename: 'selected.png', subfolder: 'chosen', type: 'output' };

function clientBoundary() {
  const executed: ComfyUIWorkflow['graph'][] = [];
  const client = {
    executeWorkflow: vi.fn(
      async (builder: PromptBuilder<string, string, ComfyUIWorkflow['graph']>) => {
        executed.push(builder.prompt);
        const chosen = builder.mapOutputKeys.images;
        return {
          images: { images: chosen === 'output' ? [firstImage, selectedImage] : [firstImage] },
        };
      },
    ),
    getNodeDefs: vi.fn(async () => definitions),
    getPathImage: (image: ImageInfo) => `https://comfyui.test/${image.subfolder}/${image.filename}`,
    uploadImage: vi.fn(async (_bytes: Buffer, name: string) => name),
  };
  return {
    client,
    executed,
    service: new ImportedWorkflowService(client as unknown as ComfyUIClientService),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('imported ComfyUI workflows', () => {
  it('accepts installed custom loaders independently of family registry and uploads distinct references unchanged', async () => {
    const { client, executed, service } = clientBoundary();
    const images = [Buffer.from('original reference one'), Buffer.from('original reference two')];
    const fetchMock = vi.fn(
      async (url: string) => new Response(url.endsWith('one') ? images[0] : images[1]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const before = structuredClone(savedWorkflow);
    const result = await service.createImage(savedWorkflow, {
      cfg: 99,
      height: 999,
      imageUrls: ['https://input.test/one', 'https://input.test/two'],
      negativePrompt: 'must not override unbound negative',
      prompt: 'new positive',
      seed: 123,
      steps: 99,
      width: 999,
    });
    expect(result.imageUrl).toBe('https://comfyui.test/chosen/selected.png');
    expect(client.uploadImage.mock.calls.map(([bytes]) => bytes)).toEqual(images);
    expect(executed[0].imageA.inputs.image).not.toBe(executed[0].imageB.inputs.image);
    expect(executed[0].textA.inputs.text).toBe('new positive');
    expect(executed[0].textB.inputs.text).toBe('new positive');
    expect(executed[0].sampler.inputs).toEqual({
      ...before.graph.sampler.inputs,
      seed: 123,
      seedAlt: 123,
    });
    expect(executed[0].loader).toEqual(before.graph.loader);
    expect(executed[0].output).toEqual(before.graph.output);
    expect(savedWorkflow).toEqual(before);
  });

  it('uploads duplicate references once and shares one random seed across bound targets', async () => {
    const { client, executed, service } = clientBoundary();
    const fetchMock = vi.fn(async () => new Response(Buffer.from('untouched bytes')));
    vi.stubGlobal('fetch', fetchMock);
    await service.createImage(savedWorkflow, {
      imageUrls: ['https://input.test/same', 'https://input.test/same'],
      prompt: 'same',
      seed: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.uploadImage).toHaveBeenCalledTimes(1);
    expect(executed[0].imageA.inputs.image).toBe(executed[0].imageB.inputs.image);
    expect(executed[0].sampler.inputs.seed).toBe(executed[0].sampler.inputs.seedAlt);
    expect(executed[0].sampler.inputs.seed).toBeGreaterThanOrEqual(0);
  });

  it('keeps all unexposed literals for graphs without bindings', async () => {
    const { executed, service } = clientBoundary();
    const workflow = structuredClone(savedWorkflow);
    workflow.bindings = {};
    workflow.graph.imageA.inputs.image = 'server-existing.png';
    workflow.graph.imageB.inputs.image = 'server-existing.png';
    await service.createImage(workflow, { prompt: '', seed: null, width: 999 });
    expect(executed[0]).toEqual(workflow.graph);
  });

  it('reports absent selected image rather than falling back to the first image', async () => {
    const { service } = clientBoundary();
    await expect(
      service.createImage(
        { ...savedWorkflow, output: { imageIndex: 2, nodeId: 'output' } },
        { prompt: 'test' },
      ),
    ).rejects.toThrow('Output node output returned no image at index 2');
  });

  it('rejects bound values against actual server enums before execution', async () => {
    const { client, service } = clientBoundary();
    const workflow = structuredClone(savedWorkflow);
    workflow.bindings.samplerName = [{ input: 'sampler_name', nodeId: 'sampler' }];
    await expect(
      service.createImage(workflow, { prompt: 'test', samplerName: 'not-installed' }),
    ).rejects.toThrow('not available on this server');
    expect(client.executeWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    ['model', 'MODEL'],
    ['steps', 'INT'],
    ['cfg', 'FLOAT'],
  ])('accepts dynamic switch connections into sampler %s', (input, outputType) => {
    const workflow = structuredClone(savedWorkflow);
    const installed = {
      ...definitions,
      ComfySwitchNode: definition(
        {
          on_false: ['COMFY_MATCHTYPE_V3', {}],
          on_true: ['COMFY_MATCHTYPE_V3', {}],
          switch: ['BOOLEAN', {}],
        },
        ['COMFY_MATCHTYPE_V3'],
      ),
      Source: definition({}, [outputType]),
    };
    workflow.graph.source = { class_type: 'Source', inputs: {} };
    workflow.graph.switch = {
      class_type: 'ComfySwitchNode',
      inputs: { on_false: ['source', 0], on_true: ['source', 0], switch: false },
    };
    workflow.graph.sampler.inputs[input] = ['switch', 0];

    expect(validateComfyUIWorkflow(workflow, installed)).toEqual({ errors: [], valid: true });

    // A dynamic port must not bypass output-slot validation.
    workflow.graph.sampler.inputs[input] = ['switch', 1];
    expect(validateComfyUIWorkflow(workflow, installed)).toEqual({
      errors: [expect.stringContaining(`input ${input}: source output switch[1] does not exist`)],
      valid: false,
    });
  });

  it.each([
    [
      'missing class',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.loader.class_type = 'UninstalledLoader';
      },
      'node class is not installed',
    ],
    [
      'missing model',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.loader.inputs.model_name = 'missing.gguf';
      },
      'check installed model, VAE, encoder',
    ],
    [
      'missing required input',
      (workflow: ComfyUIWorkflow) => {
        delete workflow.graph.sampler.inputs.steps;
      },
      'missing required input steps',
    ],
    [
      'unknown input',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.sampler.inputs.unknown = 1;
      },
      'unknown input unknown',
    ],
    [
      'wrong binding type',
      (workflow: ComfyUIWorkflow) => {
        workflow.bindings.width = [{ input: 'cfg', nodeId: 'sampler' }];
      },
      'server input is FLOAT',
    ],
    [
      'wrong source type',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.output.inputs.images = ['loader', 0];
      },
      'connected output is MODEL',
    ],
    [
      'missing source output',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.output.inputs.images = ['sampler', 1];
      },
      'does not exist',
    ],
    [
      'non-output node',
      (workflow: ComfyUIWorkflow) => {
        workflow.output.nodeId = 'sampler';
      },
      'not an output node',
    ],
    [
      'out-of-range literal',
      (workflow: ComfyUIWorkflow) => {
        workflow.graph.sampler.inputs.width = 10000;
      },
      'must be at most 4096',
    ],
  ])('reports %s with actionable node/input context', (_name, mutate, message) => {
    const workflow = structuredClone(savedWorkflow);
    mutate(workflow);
    const result = validateComfyUIWorkflow(workflow, definitions);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain(message);
  });
});
