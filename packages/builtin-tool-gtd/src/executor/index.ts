import { formatTodoStateSummary } from '@lobechat/prompts';
import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import { GTDIdentifier } from '../manifest';
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
import { GTDApiName } from '../types';
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
  createPlan: GTDApiName.createPlan,
  createTodos: GTDApiName.createTodos,
  execTask: GTDApiName.execTask,
  execTasks: GTDApiName.execTasks,
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
        ? params.adds.map((text) => ({ status: 'todo' as const, text }))
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
            // Create a new object to avoid mutating frozen/immutable objects from store
            const updatedItem = { ...updatedTodos[op.index] };
            if (op.newText !== undefined) {
              updatedItem.text = op.newText;
            }
            // Handle status field
            if (op.status !== undefined) {
              updatedItem.status = op.status;
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
            updatedTodos[op.index] = { ...updatedTodos[op.index], status: 'completed' };
            results.push(`Completed: "${updatedTodos[op.index].text}"`);
          }
          break;
        }
        case 'processing': {
          if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length) {
            // Create a new object to avoid mutating frozen/immutable objects from store
            updatedTodos[op.index] = { ...updatedTodos[op.index], status: 'processing' };
            results.push(`In progress: "${updatedTodos[op.index].text}"`);
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
      updatedTodos = existingTodos.filter((todo) => todo.status !== 'completed');
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
   * The AgentRuntime's executor will recognize this state and trigger the appropriate instruction.
   *
   * Flow:
   * 1. GTD tool returns stop: true with state.type = 'execTask' or 'execClientTask'
   * 2. AgentRuntime executor recognizes the state and triggers exec_task or exec_client_task instruction
   * 3. The executor creates task message and handles execution
   *
   * @param params.runInClient - If true, returns 'execClientTask' state for client-side execution
   */
  execTask = async (
    params: ExecTaskParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { description, instruction, inheritMessages, timeout, runInClient } = params;

    if (!description || !instruction) {
      return {
        content: 'Task description and instruction are required.',
        success: false,
      };
    }

    const task = {
      description,
      inheritMessages,
      instruction,
      runInClient,
      timeout,
    };

    // Determine state type based on runInClient
    // If runInClient is true, return 'execClientTask' to trigger client-side executor
    const stateType = runInClient ? 'execClientTask' : 'execTask';

    // Return stop: true with special state that AgentRuntime will recognize
    return {
      content: `🚀 Triggered async task for ${runInClient ? 'client-side' : ''} execution:\n- ${description}`,
      state: {
        parentMessageId: ctx.messageId,
        task,
        type: stateType,
      },
      stop: true,
      success: true,
    };
  };

  /**
   * Execute one or more async tasks
   *
   * This method triggers async task execution by returning a special state.
   * The AgentRuntime's executor will recognize this state and trigger the appropriate instruction.
   *
   * Flow:
   * 1. GTD tool returns stop: true with state.type = 'execTasks' or 'execClientTasks'
   * 2. AgentRuntime executor recognizes the state and triggers exec_tasks or exec_client_tasks instruction
   * 3. The executor creates task messages and handles execution
   *
   * Note: If any task has runInClient=true, all tasks will be routed to 'execClientTasks'.
   * This is because client-side execution is the "special" case requiring local tool access.
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

    // Check if any task requires client-side execution
    const hasClientTasks = tasks.some((t) => t.runInClient);

    // Determine state type: if any task needs client-side, route all to client executor
    const stateType = hasClientTasks ? 'execClientTasks' : 'execTasks';
    const executionMode = hasClientTasks ? 'client-side' : '';

    // Return stop: true with special state that AgentRuntime will recognize
    return {
      content: `🚀 Triggered ${taskCount} async task${taskCount > 1 ? 's' : ''} for ${executionMode} execution:\n${taskList}`,
      state: {
        parentMessageId: ctx.messageId,
        tasks,
        type: stateType,
      },
      stop: true,
      success: true,
    };
  };
}

// Export the executor instance for registration
export const gtdExecutor = new GTDExecutor();
