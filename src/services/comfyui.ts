import type { ComfyUIWorkflow } from 'model-bank';

import { lambdaClient } from '@/libs/trpc/client';

class ComfyUIService {
  validateWorkflow = (workflow: ComfyUIWorkflow) =>
    lambdaClient.comfyui.validateWorkflow.mutate({ workflow });
}

export const comfyuiService = new ComfyUIService();
