import type { ComfyUIKeyVault } from '@lobechat/types';
import type { NodeDefsResponse } from '@saintno/comfyui-sdk';
import type { ComfyUIWorkflow } from 'model-bank';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiProviderModel } from '@/database/models/aiProvider';
import { ComfyUIClientService } from '@/server/services/comfyui/core/comfyUIClientService';

import { comfyuiRouter } from '../comfyui';

vi.mock('@/database/models/aiProvider');
vi.mock('@/server/services/comfyui/core/comfyUIClientService');
vi.mock('@/envs/llm', () => ({ getLLMConfig: () => ({}) }));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: { getUserKeyVaults: vi.fn() },
}));

const workflow: ComfyUIWorkflow = {
  bindings: {},
  graph: { save: { class_type: 'CustomImageEmitter', inputs: {} } },
  output: { imageIndex: 0, nodeId: 'save' },
  version: 1,
};
const definitions: NodeDefsResponse = {
  CustomImageEmitter: {
    category: 'custom',
    description: '',
    display_name: 'Custom emitter',
    input: { hidden: {}, required: {} },
    input_order: { hidden: [], required: [] },
    name: 'CustomImageEmitter',
    output: [],
    output_is_list: [],
    output_name: [],
    output_node: true,
    output_tooltips: [],
    python_module: 'custom',
  },
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('comfyui.validateWorkflow', () => {
  it('uses authenticated workspace provider credentials, without requiring client secrets', async () => {
    const options: ComfyUIKeyVault[] = [];
    const dispose = vi.fn();
    vi.mocked(AiProviderModel).mockImplementation(function (_db, _userId, workspaceId) {
      return {
        getAiProviderById: vi.fn(async () => ({
          keyVaults: {
            apiKey: workspaceId ? 'workspace-key' : 'personal-key',
            authType: 'bearer',
            baseURL: workspaceId ? 'https://workspace.test' : 'https://personal.test',
          },
        })),
      } as unknown as AiProviderModel;
    });
    vi.mocked(ComfyUIClientService).mockImplementation(function (vault = {}) {
      options.push(vault);
      return {
        dispose,
        getNodeDefs: async () => (vault.apiKey === 'workspace-key' ? definitions : {}),
        validateConnection: async () => true,
      } as unknown as ComfyUIClientService;
    });
    const workspace = comfyuiRouter.createCaller({ userId: 'user', workspaceId: 'workspace' });
    const personal = comfyuiRouter.createCaller({ userId: 'user' });
    expect(await workspace.validateWorkflow({ workflow })).toEqual({ errors: [], valid: true });
    expect(await personal.validateWorkflow({ workflow })).toEqual({
      errors: ['Node save (CustomImageEmitter): node class is not installed'],
      valid: false,
    });
    expect(options.map(({ apiKey, baseURL }) => ({ apiKey, baseURL }))).toEqual([
      { apiKey: 'workspace-key', baseURL: 'https://workspace.test' },
      { apiKey: 'personal-key', baseURL: 'https://personal.test' },
    ]);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('returns connection failures as an honest unverified validation result', async () => {
    const dispose = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(AiProviderModel).mockImplementation(function () {
      return { getAiProviderById: async () => undefined } as unknown as AiProviderModel;
    });
    vi.mocked(ComfyUIClientService).mockImplementation(function () {
      return {
        dispose,
        validateConnection: async () => {
          throw new Error('ComfyUI is offline');
        },
      } as unknown as ComfyUIClientService;
    });
    const caller = comfyuiRouter.createCaller({ userId: 'user' });
    expect(await caller.validateWorkflow({ workflow })).toEqual({
      errors: ['ComfyUI is offline'],
      valid: false,
    });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('requires authentication and rejects client credential overrides', async () => {
    const anonymous = comfyuiRouter.createCaller({});
    await expect(anonymous.validateWorkflow({ workflow })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });

    const caller = comfyuiRouter.createCaller({ userId: 'user' });
    await expect(
      caller.validateWorkflow({ options: { apiKey: 'client-secret' }, workflow } as Parameters<
        typeof caller.validateWorkflow
      >[0]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
  it('disposes generation connections on both selected-image success and workflow validation failure', async () => {
    const dispose = vi.fn();
    let nodeDefinitions: NodeDefsResponse = definitions;
    vi.mocked(ComfyUIClientService).mockImplementation(function () {
      return {
        dispose,
        executeWorkflow: async () => ({
          images: { images: [{ filename: 'result.png', subfolder: '', type: 'output' }] },
        }),
        getNodeDefs: async () => nodeDefinitions,
        getPathImage: () => 'https://comfyui.test/result.png',
        validateConnection: async () => true,
      } as unknown as ComfyUIClientService;
    });
    const caller = comfyuiRouter.createCaller({ userId: 'user' });
    const input = {
      comfyuiWorkflow: workflow,
      model: 'comfyui/workflow-test',
      params: { prompt: '' },
    };
    expect(await caller.createImage(input)).toEqual({
      imageUrl: 'https://comfyui.test/result.png',
    });
    nodeDefinitions = {};
    await expect(caller.createImage(input)).rejects.toThrow();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});
