import debug from 'debug';

import { BaseVirtualLastUserContentProvider } from '../base/BaseVirtualLastUserContentProvider';
import { CONTEXT_INSTRUCTION, SYSTEM_CONTEXT_END, SYSTEM_CONTEXT_START } from '../base/constants';
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
 * Responsible for injecting the current todo list as a standalone virtual tail message
 * This provides the AI with real-time awareness of task progress
 */
export class TodoInjector extends BaseVirtualLastUserContentProvider {
  readonly name = 'TodoInjector';

  constructor(
    private config: TodoInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected shouldSkip(context: PipelineContext): boolean {
    if (!this.config.enabled || !this.config.todos) {
      log('Todo not enabled or no todos, skipping injection');
      return true;
    }

    const hasRealUser = context.messages.some(
      (message) =>
        message.role === 'user' &&
        message.meta?.virtualLastUser !== true &&
        message.meta?.systemInjection !== true,
    );
    if (!hasRealUser) {
      log('No user messages found, skipping injection');
      return true;
    }

    return false;
  }

  protected buildContent(_context: PipelineContext): string | null {
    const formattedContent = formatTodos(this.config.todos!);

    if (!formattedContent) {
      log('No todos to inject (empty list)');
      return null;
    }

    log('Formatted content length:', formattedContent.length);

    return `${SYSTEM_CONTEXT_START}
${CONTEXT_INSTRUCTION}
<todo_context>
${formattedContent}
</todo_context>
${SYSTEM_CONTEXT_END}`;
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    if (this.shouldSkip(context)) {
      return this.markAsExecuted(context);
    }

    const content = this.buildContent(context);
    if (!content) {
      return this.markAsExecuted(context);
    }

    const clonedContext = this.cloneContext(context);
    clonedContext.messages.push(this.createVirtualLastUserMessage(content));

    const { items } = this.config.todos!;

    clonedContext.metadata.todoInjected = true;
    clonedContext.metadata.todoCount = items.length;
    clonedContext.metadata.todoCompletedCount = items.filter(
      (item) => item.status === 'completed',
    ).length;
    clonedContext.metadata.todoProcessingCount = items.filter(
      (item) => item.status === 'processing',
    ).length;

    log('Todo context injected as virtual tail user message');

    return this.markAsExecuted(clonedContext);
  }
}
