import { escapeXml } from '@lobechat/prompts';
import type { RuntimeSelectedTool } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    selectedToolContext?: {
      injected: boolean;
      toolsCount: number;
    };
  }
}

const log = debug('context-engine:provider:SelectedToolInjector');

export interface SelectedToolInjectorConfig {
  enabled?: boolean;
  selectedTools?: RuntimeSelectedTool[];
}

const formatSelectedTools = (selectedTools: RuntimeSelectedTool[]): string | null => {
  if (selectedTools.length === 0) return null;

  const lines = [
    'The user explicitly selected these tools for this request. Use them proactively without waiting for further instruction.',
    '<selected_tools>',
  ];

  for (const tool of selectedTools) {
    if (tool.content) {
      // Tool has preloaded context — inject full description
      lines.push(
        `  <tool identifier="${escapeXml(tool.identifier)}" name="${escapeXml(tool.name)}">`,
        tool.content,
        '  </tool>',
      );
    } else {
      lines.push(
        `  <tool identifier="${escapeXml(tool.identifier)}" name="${escapeXml(tool.name)}" />`,
      );
    }
  }

  lines.push('</selected_tools>');

  return lines.join('\n');
};

/**
 * Selected Tool Injector
 * Appends user-selected tools to the last user message as ephemeral context.
 */
export class SelectedToolInjector extends BaseLastUserContentProvider {
  readonly name = 'SelectedToolInjector';

  constructor(
    private config: SelectedToolInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.config.enabled === false) return this.markAsExecuted(context);

    const clonedContext = this.cloneContext(context);
    const selectedTools = this.config.selectedTools ?? [];

    if (selectedTools.length === 0) {
      log('No selected tools, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const content = formatSelectedTools(selectedTools);

    if (!content) {
      log('No selected tool content generated, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(content, 'selected_tool_context')
      : this.wrapWithSystemContext(content, 'selected_tool_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.selectedToolContext = {
      injected: true,
      toolsCount: selectedTools.length,
    };

    log('Selected tool context appended, tools count: %d', selectedTools.length);

    return this.markAsExecuted(clonedContext);
  }
}
