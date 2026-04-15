import { formatTodoStateSummary } from '@lobechat/prompts';
import type { BuiltinToolResult } from '@lobechat/types';

import type {
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  ExecTaskParams,
  ExecTasksParams,
  Plan,
  TodoItem,
  TodoState,
  UpdatePlanParams,
  UpdateTodosParams,
} from '../types';

export interface PlanDocument {
  content: string | null;
  createdAt: Date;
  description: string | null;
  id: string;
  metadata: Record<string, any> | null;
  title: string | null;
  updatedAt: Date;
}

export interface GTDRuntimeService {
  createPlan: (args: {
    content: string;
    description: string;
    goal: string;
    topicId: string;
  }) => Promise<PlanDocument>;
  findPlanById: (id: string) => Promise<PlanDocument | null>;
  findPlanByTopic: (topicId: string) => Promise<PlanDocument | null>;
  /**
   * Update the user-facing plan fields (goal / description / context).
   * `topicId` is forwarded so client implementations can refresh their SWR cache;
   * server implementations can safely ignore it.
   */
  updatePlan: (
    id: string,
    args: { content?: string; description?: string; goal?: string },
    topicId?: string,
  ) => Promise<PlanDocument>;
  /**
   * Silently update the plan document's metadata (used for todos sync).
   * Should NOT trigger UI refresh on the client.
   */
  updatePlanMetadata: (id: string, metadata: Record<string, any>) => Promise<void>;
}

export interface GTDRuntimeContext {
  /**
   * Existing todos supplied by the caller (client: from stepContext / pluginState).
   * When undefined, the runtime resolves todos from the plan document's metadata.
   */
  currentTodos?: TodoItem[];
  /** Tool call message ID — used as `parentMessageId` for execTask/execTasks. */
  messageId?: string;
  signal?: AbortSignal;
  taskId?: string;
  topicId?: string;
}

const toPlan = (doc: PlanDocument, completed = false): Plan => ({
  completed,
  context: doc.content ?? undefined,
  createdAt: doc.createdAt.toISOString(),
  description: doc.description ?? '',
  goal: doc.title ?? '',
  id: doc.id,
  updatedAt: doc.updatedAt.toISOString(),
});

const readTodosFromPlan = (doc: PlanDocument | null): TodoItem[] => {
  const todos = doc?.metadata?.todos;
  if (!todos) return [];
  if (Array.isArray(todos)) return todos as TodoItem[];
  if (typeof todos === 'object' && Array.isArray((todos as TodoState).items)) {
    return (todos as TodoState).items;
  }
  return [];
};

export class GTDExecutionRuntime {
  private service: GTDRuntimeService;

  constructor(service: GTDRuntimeService) {
    this.service = service;
  }

  private async resolveExistingTodos(context: GTDRuntimeContext): Promise<TodoItem[]> {
    if (context.currentTodos) return context.currentTodos;
    if (!context.topicId) return [];
    const plan = await this.service.findPlanByTopic(context.topicId);
    return readTodosFromPlan(plan);
  }

  private async syncTodosToPlan(topicId: string, todos: TodoState): Promise<void> {
    try {
      const plan = await this.service.findPlanByTopic(topicId);
      if (!plan) return;
      await this.service.updatePlanMetadata(plan.id, { ...plan.metadata, todos });
    } catch (error) {
      console.warn('Failed to sync todos to plan:', error);
    }
  }

  // ==================== Todo APIs ====================

  createTodos = async (
    params: CreateTodosParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const itemsToAdd: TodoItem[] = params.items
      ? params.items
      : params.adds
        ? params.adds.map((text) => ({ status: 'todo' as const, text }))
        : [];

    if (itemsToAdd.length === 0) {
      return { content: 'No items provided to add.', success: false };
    }

    const existingTodos = await this.resolveExistingTodos(context);
    const updatedTodos = [...existingTodos, ...itemsToAdd];
    const now = new Date().toISOString();

    const addedList = itemsToAdd.map((item) => `- ${item.text}`).join('\n');
    const actionSummary = `✅ Added ${itemsToAdd.length} item${itemsToAdd.length > 1 ? 's' : ''}:\n${addedList}`;

    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (context.topicId) await this.syncTodosToPlan(context.topicId, todoState);

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        createdItems: itemsToAdd.map((item) => item.text),
        todos: todoState,
      },
      success: true,
    };
  };

  updateTodos = async (
    params: UpdateTodosParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const { operations } = params;

    if (!operations || operations.length === 0) {
      return { content: 'No operations provided.', success: false };
    }

    const existingTodos = await this.resolveExistingTodos(context);
    const updatedTodos = [...existingTodos];
    const results: string[] = [];

    for (const op of operations) {
      switch (op.type) {
        case 'add': {
          if (op.text) {
            updatedTodos.push({ status: 'todo', text: op.text });
            results.push(`Added: "${op.text}"`);
          }
          break;
        }
        case 'update': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            const updatedItem = { ...updatedTodos[op.index] };
            if (op.newText !== undefined) updatedItem.text = op.newText;
            if (op.status !== undefined) updatedItem.status = op.status;
            updatedTodos[op.index] = updatedItem;
            results.push(`Updated item ${op.index + 1}`);
          }
          break;
        }
        case 'remove': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            const removed = updatedTodos.splice(op.index, 1)[0];
            results.push(`Removed: "${removed.text}"`);
          }
          break;
        }
        case 'complete': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            updatedTodos[op.index] = { ...updatedTodos[op.index], status: 'completed' };
            results.push(`Completed: "${updatedTodos[op.index].text}"`);
          }
          break;
        }
        case 'processing': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            updatedTodos[op.index] = { ...updatedTodos[op.index], status: 'processing' };
            results.push(`In progress: "${updatedTodos[op.index].text}"`);
          }
          break;
        }
      }
    }

    const now = new Date().toISOString();
    const actionSummary =
      results.length > 0
        ? `🔄 Applied ${results.length} operation${results.length > 1 ? 's' : ''}:\n${results.map((r) => `- ${r}`).join('\n')}`
        : 'No operations applied.';

    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (context.topicId) await this.syncTodosToPlan(context.topicId, todoState);

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: { todos: todoState },
      success: true,
    };
  };

  clearTodos = async (
    params: ClearTodosParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const { mode } = params;

    const existingTodos = await this.resolveExistingTodos(context);

    if (existingTodos.length === 0) {
      const now = new Date().toISOString();
      return {
        content: 'Todo list is already empty.\n\n' + formatTodoStateSummary([], now),
        state: {
          clearedCount: 0,
          mode,
          todos: { items: [], updatedAt: now },
        },
        success: true,
      };
    }

    let updatedTodos: TodoItem[];
    let clearedCount: number;
    let actionSummary: string;

    if (mode === 'all') {
      clearedCount = existingTodos.length;
      updatedTodos = [];
      actionSummary = `🧹 Cleared all ${clearedCount} item${clearedCount > 1 ? 's' : ''} from todo list.`;
    } else {
      updatedTodos = existingTodos.filter((todo) => todo.status !== 'completed');
      clearedCount = existingTodos.length - updatedTodos.length;
      actionSummary =
        clearedCount === 0
          ? 'No completed items to clear.'
          : `🧹 Cleared ${clearedCount} completed item${clearedCount > 1 ? 's' : ''}.`;
    }

    const now = new Date().toISOString();
    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (context.topicId) await this.syncTodosToPlan(context.topicId, todoState);

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: { clearedCount, mode, todos: todoState },
      success: true,
    };
  };

  // ==================== Plan APIs ====================

  createPlan = async (
    params: CreatePlanParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (context.signal?.aborted) return { stop: true, success: false };

      if (!context.topicId) {
        return { content: 'Cannot create plan: no topic selected', success: false };
      }

      const { goal, description, context: planContext } = params;

      const doc = await this.service.createPlan({
        content: planContext ?? '',
        description,
        goal,
        topicId: context.topicId,
      });

      const plan = toPlan(doc);
      plan.context = planContext;

      return {
        content: `📋 Created plan: "${plan.goal}"\n\nYou can view this plan in the Portal sidebar.`,
        state: { plan },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: { body: e, message: err.message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  updatePlan = async (
    params: UpdatePlanParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (context.signal?.aborted) return { stop: true, success: false };

      if (!context.topicId) {
        return { content: 'Cannot update plan: no topic selected', success: false };
      }

      const { planId, goal, description, context: planContext, completed } = params;

      const existingDoc = await this.service.findPlanById(planId);
      if (!existingDoc) {
        return { content: `Plan not found: ${planId}`, success: false };
      }

      const updatedDoc = await this.service.updatePlan(
        planId,
        { content: planContext, description, goal },
        context.topicId,
      );

      const plan = toPlan(updatedDoc, completed ?? false);
      plan.context = planContext ?? existingDoc.content ?? undefined;

      return {
        content: `📝 Updated plan: "${plan.goal}"`,
        state: { plan },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: { body: e, message: err.message, type: 'PluginServerError' },
        success: false,
      };
    }
  };

  // ==================== Async Tasks API ====================

  execTask = async (
    params: ExecTaskParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const { description, instruction, inheritMessages, timeout, runInClient } = params;

    if (!description || !instruction) {
      return { content: 'Task description and instruction are required.', success: false };
    }

    const task = { description, inheritMessages, instruction, runInClient, timeout };
    const stateType = runInClient ? 'execClientTask' : 'execTask';

    return {
      content: `🚀 Triggered async task for ${runInClient ? 'client-side' : ''} execution:\n- ${description}`,
      state: { parentMessageId: context.messageId ?? '', task, type: stateType },
      stop: true,
      success: true,
    };
  };

  execTasks = async (
    params: ExecTasksParams,
    context: GTDRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const { tasks } = params;

    if (!tasks || tasks.length === 0) {
      return { content: 'No tasks provided to execute.', success: false };
    }

    const taskCount = tasks.length;
    const taskList = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');
    const hasClientTasks = tasks.some((t) => t.runInClient);
    const stateType = hasClientTasks ? 'execClientTasks' : 'execTasks';
    const executionMode = hasClientTasks ? 'client-side' : '';

    return {
      content: `🚀 Triggered ${taskCount} async task${taskCount > 1 ? 's' : ''} for ${executionMode} execution:\n${taskList}`,
      state: { parentMessageId: context.messageId ?? '', tasks, type: stateType },
      stop: true,
      success: true,
    };
  };
}
