import { escapeXml } from '@lobechat/prompts';
import type { RuntimeSelectedTool } from '@lobechat/types';
import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
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

export const formatSelectedTools = (selectedTools: RuntimeSelectedTool[]): string | null => {
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
 * Format selected tools as a complete system-context block for message content persistence.
 * Returns null if no tools are provided.
 */
export const formatSelectedToolsContext = (selectedTools: RuntimeSelectedTool[]): string | null => {
  const inner = formatSelectedTools(selectedTools);
  if (!inner) return null;

  return [
    SYSTEM_CONTEXT_START,
    CONTEXT_INSTRUCTION,
    `<selected_tool_context>`,
    inner,
    `</selected_tool_context>`,
    SYSTEM_CONTEXT_END,
  ].join('\n');
};

/**
 * Extract tool identifiers @mentioned in earlier messages via their persisted editorData.
 */
const collectMentionedToolIds = (
  messages: PipelineContext['messages'],
  excludeIndex: number,
): Set<string> => {
  const ids = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    if (i === excludeIndex) continue;
    const ed = messages[i].editorData;
    if (!ed) continue;
    walkActionTags(ed.root, (category, type) => {
      if (category === 'tool' && type) ids.add(String(type));
    });
  }
  return ids;
};

/** Walk Lexical JSON tree to find action-tag nodes. */
const walkActionTags = (node: any, cb: (category: string, type: string) => void): void => {
  if (!node) return;
  if (node.type === 'action-tag') {
    cb(node.actionCategory, node.actionType);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walkActionTags(child, cb);
  }
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
    const allSelectedTools = this.config.selectedTools ?? [];

    if (allSelectedTools.length === 0) {
      log('No selected tools, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Deduplicate: skip tools already @mentioned in earlier messages (via editorData)
    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const previousIds = collectMentionedToolIds(clonedContext.messages, lastUserIndex);
    const selectedTools =
      previousIds.size > 0
        ? allSelectedTools.filter((t) => !previousIds.has(t.identifier))
        : allSelectedTools;

    if (selectedTools.length < allSelectedTools.length) {
      log(
        'Deduplicated %d tools already @mentioned in earlier messages (via editorData)',
        allSelectedTools.length - selectedTools.length,
      );
    }

    if (selectedTools.length === 0) {
      log('All selected tools already injected in earlier messages, skipping');
      return this.markAsExecuted(clonedContext);
    }

    const content = formatSelectedTools(selectedTools);

    if (!content) {
      log('No selected tool content generated, skipping injection');
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
