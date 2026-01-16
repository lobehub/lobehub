import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:GTDTodoInjector');

/** Status of a todo item */
export type GTDTodoStatus = 'todo' | 'processing' | 'completed';

/**
 * GTD Todo item structure
 */
export interface GTDTodoItem {
  /** Status of the todo item */
  status: GTDTodoStatus;
  /** The todo item text */
  text: string;
}

/**
 * GTD Todo list structure
 */
export interface GTDTodoList {
  items: GTDTodoItem[];
  updatedAt: string;
}

export interface GTDTodoInjectorConfig {
  /** Whether GTD Todo injection is enabled */
  enabled?: boolean;
  /** The current todo list to inject */
  todos?: GTDTodoList;
}

/**
 * Format GTD Todo list content for injection
 */
function formatGTDTodos(todos: GTDTodoList): string | null {
  const { items } = todos;

  if (!items || items.length === 0) {
    return null;
  }

  const lines: string[] = ['<gtd_todos>'];

  items.forEach((item, index) => {
    lines.push(`<todo index="${index}" status="${item.status}">${item.text}</todo>`);
  });

  const completedCount = items.filter((item) => item.status === 'completed').length;
  const processingCount = items.filter((item) => item.status === 'processing').length;
  const totalCount = items.length;
  lines.push(
    `<progress completed="${completedCount}" processing="${processingCount}" total="${totalCount}" />`,
  );

  lines.push('</gtd_todos>');

  return lines.join('\n');
}

/**
 * GTD Todo Injector
 * Responsible for injecting the current todo list at the end of the last user message
 * This provides the AI with real-time awareness of task progress
 */
export class GTDTodoInjector extends BaseLastUserContentProvider {
  readonly name = 'GTDTodoInjector';

  constructor(
    private config: GTDTodoInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);

    const clonedContext = this.cloneContext(context);

    // Skip if GTD Todo is not enabled or no todos
    if (!this.config.enabled || !this.config.todos) {
      log('GTD Todo not enabled or no todos, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Format todo list content
    const formattedContent = formatGTDTodos(this.config.todos);

    // Skip if no content to inject (empty todo list)
    if (!formattedContent) {
      log('No todos to inject (empty list)');
      return this.markAsExecuted(clonedContext);
    }

    log('Formatted content length:', formattedContent.length);

    // Find the last user message index
    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    // Check if system context wrapper already exists
    // If yes, only insert context block; if no, use full wrapper
    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'gtd_todo_context')
      : this.wrapWithSystemContext(formattedContent, 'gtd_todo_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    // Update metadata
    clonedContext.metadata.gtdTodoInjected = true;
    clonedContext.metadata.gtdTodoCount = this.config.todos.items.length;
    clonedContext.metadata.gtdTodoCompletedCount = this.config.todos.items.filter(
      (item) => item.status === 'completed',
    ).length;
    clonedContext.metadata.gtdTodoProcessingCount = this.config.todos.items.filter(
      (item) => item.status === 'processing',
    ).length;

    log('GTD Todo context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
