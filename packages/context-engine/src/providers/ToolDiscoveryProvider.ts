import { type AvailableToolItem, availableToolsPrompts } from '@lobechat/prompts';
import debug from 'debug';

import { BaseFirstUserContentProvider } from '../base/BaseFirstUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:ToolDiscoveryProvider');

export interface ToolDiscoveryMeta {
  description: string;
  identifier: string;
  name: string;
}

export interface ToolDiscoveryProviderConfig {
  availableTools: ToolDiscoveryMeta[];
}

export class ToolDiscoveryProvider extends BaseFirstUserContentProvider {
  readonly name = 'ToolDiscoveryProvider';

  constructor(
    private config: ToolDiscoveryProviderConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildContent(_context: PipelineContext): string | null {
    const { availableTools } = this.config;

    if (!availableTools || availableTools.length === 0) {
      log('No available tools, skipping injection');
      return null;
    }

    const tools: AvailableToolItem[] = availableTools.map((tool) => ({
      description: tool.description,
      identifier: tool.identifier,
      name: tool.name,
    }));

    const content = availableToolsPrompts(tools);

    if (!content) {
      log('No tool content generated, skipping injection');
      return null;
    }

    log(`Tool discovery content prepared, tools count: ${availableTools.length}`);
    return content;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const result = await super.doProcess(context);

    const { availableTools } = this.config;
    if (availableTools && availableTools.length > 0) {
      result.metadata.toolDiscoveryContext = {
        injected: true,
        toolsCount: availableTools.length,
      };
    }

    return result;
  }
}
