import { formatTodoStateSummary } from '@lobechat/prompts';
import { BaseExecutor, type BuiltinToolContext, type BuiltinToolResult } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import { GTDIdentifier } from '../manifest';
import {
  type ClearTodosParams,
  type CompleteTodosParams,
  type CreatePlanParams,
  type CreateTodosParams,
  type ExecTaskParams,
  type ExecTasksParams,
  GTDApiName,
  type Plan,
  type RemoveTodosParams,
  type TodoItem,
  type TodoState,
  type UpdatePlanParams,
  type UpdateTodosParams,
} from '../types';
import { getTodosFromContext } from './helper';

/**
 * Sync todos to the Plan document's metadata
 * This allows the Plan to track todos persistently
 */
const syncTodosToPlan = async (topicId: string, todos: TodoState): Promise<void> => {
  try {
    // List all documents for this topic with type 'agent/plan'
    const result = await notebookService.listDocuments({ topicId, type: 'agent/plan' });

    // If there's a plan document, update its metadata with the todos
    if (result.data.length > 0) {
      // Update the first (most recent) plan document
      const planDoc = result.data[0];
      await notebookService.updateDocument({
        id: planDoc.id,
        metadata: { todos },
      });
    }
  } catch (error) {
    // Silently fail - todo sync is a non-critical feature
    console.warn('Failed to sync todos to plan:', error);
  }
};

// API enum for MVP (Todo + Plan)
const GTDApiNameEnum = {
  clearTodos: GTDApiName.clearTodos,
  completeTodos: GTDApiName.completeTodos,
  createPlan: GTDApiName.createPlan,
  createTodos: GTDApiName.createTodos,
  execTask: GTDApiName.execTask,
  execTasks: GTDApiName.execTasks,
  removeTodos: GTDApiName.removeTodos,
  updatePlan: GTDApiName.updatePlan,
  updateTodos: GTDApiName.updateTodos,
} as const;

/**
 * GTD Tool Executor
 */
class GTDExecutor extends BaseExecutor<typeof GTDApiNameEnum> {
  readonly identifier = GTDIdentifier;
  protected readonly apiEnum = GTDApiNameEnum;

  // ==================== Todo APIs ====================

  /**
   * Create new todo items
   * Handles both formats:
   * - AI input: { adds: string[] }
   * - User-edited: { items: TodoItem[] }
   */
  createTodos = async (
    params: CreateTodosParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    // Handle both formats: items (user-edited) takes priority over adds (AI input)
    const itemsToAdd: TodoItem[] = params.items
      ? params.items
      : params.adds
        ? params.adds.map((text) => ({ completed: false, text }))
        : [];

    if (itemsToAdd.length === 0) {
      return {
        content: 'No items provided to add.',
        success: false,
      };
    }

    // Get current todos from step context (priority) or plugin state (fallback)
    const existingTodos = getTodosFromContext(ctx);

    // Add new items
    const now = new Date().toISOString();
    const updatedTodos = [...existingTodos, ...itemsToAdd];

    // Format response: action summary + todo state
    const addedList = itemsToAdd.map((item) => `- ${item.text}`).join('\n');
    const actionSummary = `✅ Added ${itemsToAdd.length} item${itemsToAdd.length > 1 ? 's' : ''}:\n${addedList}`;

    const todoState = { items: updatedTodos, updatedAt: now };

    // Sync todos to Plan document if topic exists
    if (ctx.topicId) {
      await syncTodosToPlan(ctx.topicId, todoState);
    }

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        createdItems: itemsToAdd.map((item) => item.text),
        todos: todoState,
      },
      success: true,
    };
  };

  /**
   * Update todo items with batch operations
   */
  updateTodos = async (
    params: UpdateTodosParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { operations } = params;

    if (!operations || operations.length === 0) {
      return {
        content: 'No operations provided.',
        success: false,
      };
    }

    const existingTodos = getTodosFromContext(ctx);
    let updatedTodos = [...existingTodos];
    const results: string[] = [];

    for (const op of operations) {
      switch (op.type) {
        case 'add': {
          if (op.text) {
            updatedTodos.push({ completed: false, text: op.text });
            results.push(`Added: "${op.text}"`);
          }
          break;
        }
        case 'update': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            // Create a new object to avoid mutating frozen/immutable objects from store
            const updatedItem = { ...updatedTodos[op.index] };
            if (op.newText !== undefined) {
              updatedItem.text = op.newText;
            }
            if (op.completed !== undefined) {
              updatedItem.completed = op.completed;
            }
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
            // Create a new object to avoid mutating frozen/immutable objects from store
            updatedTodos[op.index] = { ...updatedTodos[op.index], completed: true };
            results.push(`Completed: "${updatedTodos[op.index].text}"`);
          }
          break;
        }
      }
    }

    const now = new Date().toISOString();

    // Format response: action summary + todo state
    const actionSummary =
      results.length > 0
        ? `🔄 Applied ${results.length} operation${results.length > 1 ? 's' : ''}:\n${results.map((r) => `- ${r}`).join('\n')}`
        : 'No operations applied.';

    const todoState = { items: updatedTodos, updatedAt: now };

    // Sync todos to Plan document if topic exists
    if (ctx.topicId) {
      await syncTodosToPlan(ctx.topicId, todoState);
    }

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        todos: todoState,
      },
      success: true,
    };
  };

  /**
   * Mark todo items as done by their indices
   */
  completeTodos = async (
    params: CompleteTodosParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { indices } = params;

    if (!indices || indices.length === 0) {
      return {
        content: 'No indices provided to complete.',
        success: false,
      };
    }

    const existingTodos = getTodosFromContext(ctx);

    if (existingTodos.length === 0) {
      const now = new Date().toISOString();
      return {
        content: 'No todos to complete. The list is empty.\n\n' + formatTodoStateSummary([], now),
        state: {
          completedIndices: [],
          todos: { items: [], updatedAt: now },
        },
        success: true,
      };
    }

    // Validate indices
    const validIndices = indices.filter((i: number) => i >= 0 && i < existingTodos.length);
    const invalidIndices = indices.filter((i: number) => i < 0 || i >= existingTodos.length);

    if (validIndices.length === 0) {
      return {
        content: `Invalid indices: ${indices.join(', ')}. Valid range is 0-${existingTodos.length - 1}.`,
        success: false,
      };
    }

    // Mark items as completed
    const updatedTodos = existingTodos.map((todo, index) => {
      if (validIndices.includes(index)) {
        return { ...todo, completed: true };
      }
      return todo;
    });

    const completedItems = validIndices.map((i: number) => existingTodos[i].text);
    const now = new Date().toISOString();

    // Format response: action summary + todo state
    let actionSummary = `✔️ Completed ${validIndices.length} item${validIndices.length > 1 ? 's' : ''}:\n`;
    actionSummary += completedItems.map((text: string) => `- ${text}`).join('\n');

    if (invalidIndices.length > 0) {
      actionSummary += `\n\nNote: Ignored invalid indices: ${invalidIndices.join(', ')}`;
    }

    const todoState = { items: updatedTodos, updatedAt: now };

    // Sync todos to Plan document if topic exists
    if (ctx.topicId) {
      await syncTodosToPlan(ctx.topicId, todoState);
    }

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        completedIndices: validIndices,
        todos: todoState,
      },
      success: true,
    };
  };

  /**
   * Remove todo items by indices
   */
  removeTodos = async (
    params: RemoveTodosParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { indices } = params;

    if (!indices || indices.length === 0) {
      return {
        content: 'No indices provided to remove.',
        success: false,
      };
    }

    const existingTodos = getTodosFromContext(ctx);

    if (existingTodos.length === 0) {
      const now = new Date().toISOString();
      return {
        content: 'No todos to remove. The list is empty.\n\n' + formatTodoStateSummary([], now),
        state: {
          removedIndices: [],
          todos: { items: [], updatedAt: now },
        },
        success: true,
      };
    }

    // Validate indices
    const validIndices = indices.filter((i: number) => i >= 0 && i < existingTodos.length);
    const invalidIndices = indices.filter((i: number) => i < 0 || i >= existingTodos.length);

    if (validIndices.length === 0) {
      return {
        content: `Invalid indices: ${indices.join(', ')}. Valid range is 0-${existingTodos.length - 1}.`,
        success: false,
      };
    }

    // Remove items
    const removedItems = validIndices.map((i: number) => existingTodos[i].text);
    const updatedTodos = existingTodos.filter((_, index) => !validIndices.includes(index));
    const now = new Date().toISOString();

    // Format response: action summary + todo state
    let actionSummary = `🗑️ Removed ${validIndices.length} item${validIndices.length > 1 ? 's' : ''}:\n`;
    actionSummary += removedItems.map((text: string) => `- ${text}`).join('\n');

    if (invalidIndices.length > 0) {
      actionSummary += `\n\nNote: Ignored invalid indices: ${invalidIndices.join(', ')}`;
    }

    const todoState = { items: updatedTodos, updatedAt: now };

    // Sync todos to Plan document if topic exists
    if (ctx.topicId) {
      await syncTodosToPlan(ctx.topicId, todoState);
    }

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        removedIndices: validIndices,
        todos: todoState,
      },
      success: true,
    };
  };

  /**
   * Clear todo items
   */
  clearTodos = async (
    params: ClearTodosParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { mode } = params;

    const existingTodos = getTodosFromContext(ctx);

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
      // mode === 'completed'
      updatedTodos = existingTodos.filter((todo) => !todo.completed);
      clearedCount = existingTodos.length - updatedTodos.length;

      if (clearedCount === 0) {
        actionSummary = 'No completed items to clear.';
      } else {
        actionSummary = `🧹 Cleared ${clearedCount} completed item${clearedCount > 1 ? 's' : ''}.`;
      }
    }

    const now = new Date().toISOString();
    const todoState = { items: updatedTodos, updatedAt: now };

    // Sync todos to Plan document if topic exists
    if (ctx.topicId) {
      await syncTodosToPlan(ctx.topicId, todoState);
    }

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        clearedCount,
        mode,
        todos: todoState,
      },
      success: true,
    };
  };

  // ==================== Plan APIs ====================

  /**
   * Create a new plan document
   */
  createPlan = async (
    params: CreatePlanParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      if (!ctx.topicId) {
        return {
          content: 'Cannot create plan: no topic selected',
          success: false,
        };
      }

      const { goal, description, context } = params;

      // Create document with type 'agent/plan'
      // Field mapping: goal -> title, description -> description, context -> content
      const document = await useNotebookStore.getState().createDocument({
        content: context || '',
        description,
        title: goal,
        topicId: ctx.topicId,
        type: 'agent/plan',
      });

      const plan: Plan = {
        completed: false,
        context,
        createdAt: document.createdAt.toISOString(),
        description: document.description || '',
        goal: document.title || '',
        id: document.id,
        updatedAt: document.updatedAt.toISOString(),
      };

      return {
        content: `📋 Created plan: "${plan.goal}"\n\nYou can view this plan in the Portal sidebar.`,
        state: { plan },
        success: true,
      };
    } catch (e) {
      const err = e as Error;
      return {
        error: {
          body: e,
          message: err.message,
          type: 'PluginServerError',
        },
        success: false,
      };
    }
  };

  /**
   * Update an existing plan document
   */
  updatePlan = async (
    params: UpdatePlanParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    try {
      if (ctx.signal?.aborted) {
        return { stop: true, success: false };
      }

      const { planId, goal, description, context, completed } = params;

      if (!ctx.topicId) {
        return {
          content: 'Cannot update plan: no topic selected',
          success: false,
        };
      }

      // Get existing document
      const existingDoc = await notebookService.getDocument(planId);
      if (!existingDoc) {
        return {
          content: `Plan not found: ${planId}`,
          success: false,
        };
      }

      // Update document using store (triggers refresh)
      // Field mapping: goal -> title, description -> description, context -> content
      const document = await useNotebookStore.getState().updateDocument(
        {
          content: context,
          description,
          id: planId,
          title: goal,
        },
        ctx.topicId,
      );

      const plan: Plan = {
        completed: completed ?? false,
        context: context ?? existingDoc.content ?? undefined,
        createdAt: document?.createdAt.toISOString() || '',
        description: document?.description || existingDoc.description || '',
        goal: document?.title || existingDoc.title || '',
        id: planId,
        updatedAt: document?.updatedAt.toISOString() || '',
      };

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

  /**
   * Execute a single async task
   *
   * This method triggers async task execution by returning a special state.
   * The AgentRuntime's executor will recognize this state and trigger the exec_task instruction.
   *
   * Flow:
   * 1. GTD tool returns stop: true with state.type = 'execTask'
   * 2. AgentRuntime executor recognizes the state and triggers exec_task instruction
   * 3. exec_task executor creates task message and polls for completion
   */
  execTask = async (
    params: ExecTaskParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { description, instruction, inheritMessages, timeout } = params;

    if (!description || !instruction) {
      return {
        content: 'Task description and instruction are required.',
        success: false,
      };
    }

    // Return stop: true with special state that AgentRuntime will recognize
    // The exec_task executor will be triggered by the runtime when it sees this state
    return {
      content: `🚀 Triggered async task for execution:\n- ${description}`,
      state: {
        parentMessageId: ctx.messageId,
        task: {
          description,
          inheritMessages,
          instruction,
          timeout,
        },
        type: 'execTask',
      },
      stop: true,
      success: true,
    };
  };

  /**
   * Execute one or more async tasks
   *
   * This method triggers async task execution by returning a special state.
   * The AgentRuntime's executor will recognize this state and trigger the exec_tasks instruction.
   *
   * Flow:
   * 1. GTD tool returns stop: true with state.type = 'execTasks'
   * 2. AgentRuntime executor recognizes the state and triggers exec_tasks instruction
   * 3. exec_tasks executor creates task messages and polls for completion
   */
  execTasks = async (
    params: ExecTasksParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { tasks } = params;

    if (!tasks || tasks.length === 0) {
      return {
        content: 'No tasks provided to execute.',
        success: false,
      };
    }

    const taskCount = tasks.length;
    const taskList = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');

    // Return stop: true with special state that AgentRuntime will recognize
    // The exec_tasks executor will be triggered by the runtime when it sees this state
    return {
      content: `🚀 Triggered ${taskCount} async task${taskCount > 1 ? 's' : ''} for execution:\n${taskList}`,
      state: {
        parentMessageId: ctx.messageId,
        tasks,
        type: 'execTasks',
      },
      stop: true,
      success: true,
    };
  };
}

// Export the executor instance for registration
export const gtdExecutor = new GTDExecutor();
