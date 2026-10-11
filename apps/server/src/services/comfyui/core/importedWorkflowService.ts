import { generateUniqueSeeds } from '@lobechat/utils';
import type { NodeData, NodeDefsResponse } from '@saintno/comfyui-sdk';
import { PromptBuilder } from '@saintno/comfyui-sdk';
import type { ComfyUIWorkflow, RuntimeImageGenParams } from 'model-bank';
import { ComfyUIWorkflowSchema } from 'model-bank';

import { ServicesError } from '@/server/services/comfyui/errors';
import { nanoid } from '@/utils/uuid';

import type { ComfyUIClientService } from './comfyUIClientService';
import { validateComfyUIWorkflow } from './workflowValidationService';

export class ImportedWorkflowService {
  constructor(private clientService: ComfyUIClientService) {}

  async createImage(savedWorkflow: ComfyUIWorkflow, params: RuntimeImageGenParams) {
    // Zod parses into a fresh graph: replacing bindings never mutates persisted JSON.
    const workflow = ComfyUIWorkflowSchema.parse(savedWorkflow);
    const definitions: NodeDefsResponse = await this.clientService.getNodeDefs();
    this.assertValid(workflow, definitions);

    const uploaded = new Map<string, Promise<string>>();
    const timestamp = Date.now();
    let randomSeed: number | undefined;
    for (const [parameter, bindings] of Object.entries(workflow.bindings)) {
      for (const binding of bindings ?? []) {
        let value = params[parameter as keyof RuntimeImageGenParams];
        if (parameter === 'seed' && value === null) {
          randomSeed ??= generateUniqueSeeds(1)[0];
          value = randomSeed;
        }
        if (parameter === 'imageUrls') {
          const url = params.imageUrls?.[binding.imageIndex!];
          // No supplied reference leaves the saved literal intact.
          if (url === undefined) continue;
          if (!uploaded.has(url)) uploaded.set(url, this.uploadReference(url, timestamp));
          value = await uploaded.get(url)!;
        }
        if (value !== undefined && value !== null) {
          if (typeof value !== 'string' && typeof value !== 'number') {
            throw new ServicesError(
              `Invalid value for workflow binding ${parameter}`,
              ServicesError.Reasons.INVALID_ARGS,
            );
          }
          workflow.graph[binding.nodeId].inputs[binding.input] = value;
        }
      }
    }
    this.assertValid(workflow, definitions);
    // The SDK type requires editor titles, but its API accepts graphs without _meta.
    const builder = new PromptBuilder(workflow.graph as NodeData, [], ['images']).setRawOutputNode(
      'images',
      workflow.output.nodeId,
    );
    const result = await this.clientService.executeWorkflow(builder);
    // SDK maps precisely the selected node to `images`, not an arbitrary first output.
    const image = result.images?.images?.[workflow.output.imageIndex];
    if (!image) {
      throw new ServicesError(
        `Output node ${workflow.output.nodeId} returned no image at index ${workflow.output.imageIndex}`,
        ServicesError.Reasons.EMPTY_RESULT,
      );
    }
    return { imageUrl: this.clientService.getPathImage(image) };
  }

  private assertValid(workflow: ComfyUIWorkflow, definitions: NodeDefsResponse) {
    const result = validateComfyUIWorkflow(workflow, definitions);
    if (!result.valid)
      throw new ServicesError(result.errors.join('\n'), ServicesError.Reasons.INVALID_ARGS);
  }

  private async uploadReference(url: string, timestamp: number): Promise<string> {
    // Uploaded ComfyUI filenames are accepted as-is. HTTP/data URLs are fetched without resizing.
    if (!/^(?:https?:\/\/|data:)/i.test(url)) return url;
    const response = await fetch(url);
    if (!response.ok)
      throw new ServicesError(
        `Failed to fetch reference image: ${response.status}`,
        ServicesError.Reasons.IMAGE_FETCH_FAILED,
      );
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0)
      throw new ServicesError('Reference image is empty', ServicesError.Reasons.IMAGE_FETCH_FAILED);
    return this.clientService.uploadImage(data, `LobeChat_workflow_${timestamp}_${nanoid(8)}.png`);
  }
}
