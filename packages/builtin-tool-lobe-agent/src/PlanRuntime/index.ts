import { formatTodoStateSummary } from '@lobechat/prompts';
import type { BuiltinToolResult } from '@lobechat/types';

import type {
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  Plan,
  TodoItem,
  TodoState,
  TodoUpdateOperation,
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

export interface PlanRuntimeService {
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

export interface PlanRuntimeContext {
  /**
   * Existing todos supplied by the caller (client: from stepContext / pluginState).
   * When undefined, the runtime resolves todos from the plan document's metadata.
   */
  currentTodos?: TodoItem[];
  /** Tool call message ID. */
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

/**
 * Weak instruction-following models drop the required `type` discriminator
 * while still sending an unambiguous payload (production example from
 * glm-5.3-flash: `{"index": 0, "status": "processing"}`). Infer the operation
 * type where the intent is unambiguous; index-only payloads stay undefined —
 * they could equally mean `remove` or `complete`, and guessing a destructive
 * operation is worse than asking the model to retry.
 */
const inferOperationType = (op: TodoUpdateOperation): TodoUpdateOperation['type'] | undefined => {
  if (op.type) return op.type;
  if (op.index !== undefined && (op.status !== undefined || op.newText !== undefined))
    return 'update';
  if (op.index === undefined && op.text !== undefined) return 'add';
  return undefined;
};

const readTodosFromPlan = (doc: PlanDocument | null): TodoItem[] => {
  const todos = doc?.metadata?.todos;
  if (!todos) return [];
  if (Array.isArray(todos)) return todos as TodoItem[];
  if (typeof todos === 'object' && Array.isArray((todos as TodoState).items)) {
    return (todos as TodoState).items;
  }
  return [];
};

export class PlanExecutionRuntime {
  private service: PlanRuntimeService;

  constructor(service: PlanRuntimeService) {
    this.service = service;
  }

  private async resolveExistingTodos(context: PlanRuntimeContext): Promise<TodoItem[]> {
    // Only `undefined` means "caller doesn't know" — an empty array is a real
    // answer. After `clearTodos`, message history legitimately reports `[]`, and
    // treating that as missing would reload the plan document and resurrect the
    // items the agent just cleared (the plan document is a best-effort mirror
    // whose sync failure is swallowed, so it can easily still hold them).
    if (context.currentTodos !== undefined) return context.currentTodos;
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
    context: PlanRuntimeContext,
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
    context: PlanRuntimeContext,
  ): Promise<BuiltinToolResult> => {
    const { operations } = params;

    if (!operations || operations.length === 0) {
      return { content: 'No operations provided.', success: false };
    }

    const existingTodos = await this.resolveExistingTodos(context);
    const updatedTodos = [...existingTodos];
    const results: string[] = [];
    const skipped: string[] = [];

    operations.forEach((op, position) => {
      const label = `Operation ${position + 1}`;
      const type = inferOperationType(op);

      const resolveIndex = (): number | undefined => {
        if (op.index !== undefined && op.index >= 0 && op.index < updatedTodos.length)
          return op.index;
        skipped.push(
          `${label} ("${type}"): "index" must be 0-${updatedTodos.length - 1}, got ${op.index ?? 'nothing'}`,
        );
        return undefined;
      };

      switch (type) {
        case 'add': {
          if (op.text) {
            updatedTodos.push({ status: 'todo', text: op.text });
            results.push(`Added: "${op.text}"`);
          } else {
            skipped.push(`${label} ("add"): missing "text"`);
          }
          break;
        }
        case 'update': {
          // An update that carries neither field would "apply" without changing
          // anything — the same silent success this whole branch exists to kill.
          if (op.newText === undefined && op.status === undefined) {
            skipped.push(
              `${label} ("update"): provide "newText" and/or "status" (use "remove"/"complete" to drop or finish an item)`,
            );
            break;
          }
          const index = resolveIndex();
          if (index !== undefined) {
            const updatedItem = { ...updatedTodos[index] };
            if (op.newText !== undefined) updatedItem.text = op.newText;
            if (op.status !== undefined) updatedItem.status = op.status;
            updatedTodos[index] = updatedItem;
            results.push(`Updated item ${index + 1}`);
          }
          break;
        }
        case 'remove': {
          const index = resolveIndex();
          if (index !== undefined) {
            const removed = updatedTodos.splice(index, 1)[0];
            results.push(`Removed: "${removed.text}"`);
          }
          break;
        }
        case 'complete': {
          const index = resolveIndex();
          if (index !== undefined) {
            updatedTodos[index] = { ...updatedTodos[index], status: 'completed' };
            results.push(`Completed: "${updatedTodos[index].text}"`);
          }
          break;
        }
        case 'processing': {
          const index = resolveIndex();
          if (index !== undefined) {
            updatedTodos[index] = { ...updatedTodos[index], status: 'processing' };
            results.push(`In progress: "${updatedTodos[index].text}"`);
          }
          break;
        }
        default: {
          skipped.push(
            `${label}: "type" is required and must be one of add / update / remove / complete / processing, e.g. {"type": "update", "index": 0, "status": "processing"}`,
          );
        }
      }
    });

    const now = new Date().toISOString();
    const skippedSummary =
      skipped.length > 0
        ? `⚠️ Skipped ${skipped.length} invalid operation${skipped.length > 1 ? 's' : ''}:\n${skipped.map((r) => `- ${r}`).join('\n')}`
        : '';

    // Every operation was invalid: fail loudly so the model can fix its
    // arguments and retry, instead of reading a "success" that changed nothing
    // (observed in production: 5 identical retries against a silent no-op).
    if (results.length === 0) {
      return {
        content: [
          'No operations applied.',
          skippedSummary,
          formatTodoStateSummary(existingTodos, now),
        ]
          .filter(Boolean)
          .join('\n\n'),
        success: false,
      };
    }

    const actionSummary = `🔄 Applied ${results.length} operation${results.length > 1 ? 's' : ''}:\n${results.map((r) => `- ${r}`).join('\n')}`;

    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (context.topicId) await this.syncTodosToPlan(context.topicId, todoState);

    return {
      content: [actionSummary, skippedSummary, formatTodoStateSummary(updatedTodos, now)]
        .filter(Boolean)
        .join('\n\n'),
      state: { todos: todoState },
      success: true,
    };
  };

  clearTodos = async (
    params: ClearTodosParams,
    context: PlanRuntimeContext,
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
    context: PlanRuntimeContext,
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
    context: PlanRuntimeContext,
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
}
