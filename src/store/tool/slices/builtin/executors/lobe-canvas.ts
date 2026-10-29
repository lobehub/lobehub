import { CanvasApiName, CanvasIdentifier } from '@lobechat/builtin-tool-canvas';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { canvasService } from '@/services/canvas';
import { stashWorkIntent } from '@/utils/clientWorkIntentStash';

class CanvasExecutor extends BaseExecutor<typeof CanvasApiName> {
  readonly identifier = CanvasIdentifier;
  protected readonly apiEnum = CanvasApiName;

  readCanvasGuide = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(CanvasApiName.readCanvasGuide, params, ctx);

  createCanvas = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(CanvasApiName.createCanvas, params, ctx);

  updateCanvas = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(CanvasApiName.updateCanvas, params, ctx);

  readCanvas = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(CanvasApiName.readCanvas, params, ctx);

  listCanvases = (params: unknown, ctx?: BuiltinToolContext) =>
    this.run(CanvasApiName.listCanvases, params, ctx);

  private run = async (
    apiName: string,
    params: unknown,
    ctx?: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      const { intent, output } = await canvasService.runAgentTool(apiName, params, {
        agentId: ctx?.agentId,
        messageId: ctx?.messageId,
        threadId: ctx?.threadId ?? undefined,
        topicId: ctx?.topicId ?? undefined,
      });
      if (intent) stashWorkIntent(ctx?.toolCallId, intent);

      const content = output.content || 'Canvas tool returned no content';
      if (!output.success) {
        return {
          content,
          error: { body: output.error, message: content, type: 'PluginServerError' },
          state: output.state,
          success: false,
        };
      }
      return { content, state: output.state, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: `Failed to run ${apiName}: ${message}`,
        error: { message, type: 'CanvasToolFailed' },
        success: false,
      };
    }
  };
}

export const canvasExecutor = new CanvasExecutor();
