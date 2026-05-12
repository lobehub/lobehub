import debug from 'debug';

import { BaseLastUserContentProvider } from '../base/BaseLastUserContentProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    todoCompletedCount?: number;
    todoCount?: number;
    todoInjected?: boolean;
    todoProcessingCount?: number;
  }
}

const log = debug('context-engine:provider:TodoInjector');

/** Status of a todo item */
export type TodoStatus = 'todo' | 'processing' | 'completed';

/**
 * Todo item structure
 */
export interface TodoItem {
  /** Status of the todo item */
  status: TodoStatus;
  /** The todo item text */
  text: string;
}

/**
 * Todo list structure
 */
export interface TodoList {
  items: TodoItem[];
  updatedAt: string;
}

export interface TodoInjectorConfig {
  /** Whether Todo injection is enabled */
  enabled?: boolean;
  /** The current todo list to inject */
  todos?: TodoList;
}

/**
 * Format Todo list content for injection
 */
function formatTodos(todos: TodoList): string | null {
  const { items } = todos;

  if (!items || items.length === 0) {
    return null;
  }

  const lines: string[] = ['<todos>'];

  items.forEach((item, index) => {
    lines.push(`<todo index="${index}" status="${item.status}">${item.text}</todo>`);
  });

  const completedCount = items.filter((item) => item.status === 'completed').length;
  const processingCount = items.filter((item) => item.status === 'processing').length;
  const totalCount = items.length;
  lines.push(
    `<progress completed="${completedCount}" processing="${processingCount}" total="${totalCount}" />`,
  );

  lines.push('</todos>');

  return lines.join('\n');
}

/**
 * Todo Injector
 * Responsible for injecting the current todo list at the end of the last user message
 * This provides the AI with real-time awareness of task progress
 */
export class TodoInjector extends BaseLastUserContentProvider {
  readonly name = 'TodoInjector';

  constructor(
    private config: TodoInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    log('doProcess called');
    log('config.enabled:', this.config.enabled);

    const clonedContext = this.cloneContext(context);

    if (!this.config.enabled || !this.config.todos) {
      log('Todo not enabled or no todos, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formattedContent = formatTodos(this.config.todos);

    if (!formattedContent) {
      log('No todos to inject (empty list)');
      return this.markAsExecuted(clonedContext);
    }

    log('Formatted content length:', formattedContent.length);

    const lastUserIndex = this.findLastUserMessageIndex(clonedContext.messages);

    log('Last user message index:', lastUserIndex);

    if (lastUserIndex === -1) {
      log('No user messages found, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const hasExistingWrapper = this.hasExistingSystemContext(clonedContext);
    const contentToAppend = hasExistingWrapper
      ? this.createContextBlock(formattedContent, 'todo_context')
      : this.wrapWithSystemContext(formattedContent, 'todo_context');

    this.appendToLastUserMessage(clonedContext, contentToAppend);

    clonedContext.metadata.todoInjected = true;
    clonedContext.metadata.todoCount = this.config.todos.items.length;
    clonedContext.metadata.todoCompletedCount = this.config.todos.items.filter(
      (item) => item.status === 'completed',
    ).length;
    clonedContext.metadata.todoProcessingCount = this.config.todos.items.filter(
      (item) => item.status === 'processing',
    ).length;

    log('Todo context appended to last user message');

    return this.markAsExecuted(clonedContext);
  }
}
