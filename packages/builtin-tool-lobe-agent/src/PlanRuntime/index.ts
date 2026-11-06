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
   * Update plan metadata (todos sync), forwarding its topic for client cache refresh.
   */
  updatePlanMetadata: (id: string, metadata: Record<string, any>, topicId: string) => Promise<void>;
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
  /**
   * Todo-mutating calls made right before this one with no other tool call in
   * between. Supplied by the server runtime; undefined disables the pause.
   */
  todoCallStreak?: number;
  topicId?: string;
}

/**
 * Consecutive todo calls allowed before the todo APIs pause. A real plan needs a
 * create plus a few status flips between pieces of work; ten in a row with
 * nothing else is a model re-managing its list instead of working (production:
 * ~490 todo calls in one 33-minute run, each answering "success").
 */
export const TODO_CALL_STREAK_LIMIT = 10;

export interface PlanRuntimeOptions {
  /** Consecutive todo calls allowed before the todo APIs pause. */
  todoCallStreakLimit?: number;
}

/**
 * Appended to every result that changed nothing. Without it a no-op reads as a
 * fresh success, which the looping model took as progress and repeated.
 */
const NO_CHANGE_HINT =
  'The todo list is already in this state, so calling again will not change it. Continue with the actual task.';

const normalizeText = (text: string) => text.trim();

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
  private todoCallStreakLimit: number;

  constructor(service: PlanRuntimeService, options: PlanRuntimeOptions = {}) {
    this.service = service;
    this.todoCallStreakLimit = options.todoCallStreakLimit ?? TODO_CALL_STREAK_LIMIT;
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

  /**
   * Refuse a todo mutation once the streak limit is reached, without touching
   * the list. The refusal carries no `todos` state, so the list it reports stays
   * the one message history already holds; the next non-todo tool call resets
   * the streak.
   */
  private async pauseIfLooping(
    apiName: string,
    context: PlanRuntimeContext,
  ): Promise<BuiltinToolResult | undefined> {
    const streak = context.todoCallStreak ?? 0;
    if (streak < this.todoCallStreakLimit) return;

    console.warn('[lobe-agent] todo tools paused for a todo-only call streak', {
      apiName,
      streak,
      topicId: context.topicId,
    });

    const existingTodos = await this.resolveExistingTodos(context);

    return {
      content: [
        `⏸️ Todo tools paused: this is todo call ${streak + 1} in a row with no other work in between. Nothing was changed.`,
        'Stop calling createTodos / updateTodos / clearTodos. The list below is current: do the actual work for the next item (or reply to the user), then update the list once.',
        formatTodoStateSummary(existingTodos, new Date().toISOString()),
      ].join('\n\n'),
      error: {
        message: `Todo tools paused after ${streak} consecutive todo calls`,
        type: 'TodoCallLoop',
      },
      success: false,
    };
  }

  private async syncTodosToPlan(topicId: string, todos: TodoState): Promise<void> {
    try {
      const plan = await this.service.findPlanByTopic(topicId);
      if (!plan) return;
      await this.service.updatePlanMetadata(plan.id, { ...plan.metadata, todos }, topicId);
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

    const paused = await this.pauseIfLooping('createTodos', context);
    if (paused) return paused;

    const existingTodos = await this.resolveExistingTodos(context);
    const now = new Date().toISOString();

    // Re-creating an item that is still open duplicates it rather than adding
    // work. Completed items may legitimately come back as a new round.
    const openTexts = new Set(
      existingTodos
        .filter((item) => item.status !== 'completed')
        .map((item) => normalizeText(item.text)),
    );
    const newItems: TodoItem[] = [];
    const duplicates: string[] = [];
    for (const item of itemsToAdd) {
      const text = normalizeText(item.text);
      if (openTexts.has(text)) {
        duplicates.push(item.text);
        continue;
      }
      openTexts.add(text);
      newItems.push(item);
    }

    const duplicateSummary =
      duplicates.length > 0
        ? `ℹ️ Skipped ${duplicates.length} item${duplicates.length > 1 ? 's' : ''} already on the list:\n${duplicates.map((text) => `- ${text}`).join('\n')}`
        : '';

    if (newItems.length === 0) {
      return {
        content: [
          `${duplicateSummary}\n\n${NO_CHANGE_HINT}`,
          formatTodoStateSummary(existingTodos, now),
        ].join('\n\n'),
        state: { createdItems: [], todos: { items: existingTodos, updatedAt: now } },
        success: true,
      };
    }

    const updatedTodos = [...existingTodos, ...newItems];
    const addedList = newItems.map((item) => `- ${item.text}`).join('\n');
    const actionSummary = [
      `✅ Added ${newItems.length} item${newItems.length > 1 ? 's' : ''}:\n${addedList}`,
      duplicateSummary,
    ]
      .filter(Boolean)
      .join('\n\n');

    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (context.topicId) await this.syncTodosToPlan(context.topicId, todoState);

    return {
      content: actionSummary + '\n\n' + formatTodoStateSummary(updatedTodos, now),
      state: {
        createdItems: newItems.map((item) => item.text),
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

    const paused = await this.pauseIfLooping('updateTodos', context);
    if (paused) return paused;

    const existingTodos = await this.resolveExistingTodos(context);
    const updatedTodos = [...existingTodos];
    const results: string[] = [];
    const skipped: string[] = [];
    let changed = false;

    const setItem = (index: number, item: TodoItem) => {
      const current = updatedTodos[index];
      if (current.text !== item.text || current.status !== item.status) changed = true;
      updatedTodos[index] = item;
    };

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
            changed = true;
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
            setItem(index, updatedItem);
            results.push(`Updated item ${index + 1}`);
          }
          break;
        }
        case 'remove': {
          const index = resolveIndex();
          if (index !== undefined) {
            const removed = updatedTodos.splice(index, 1)[0];
            changed = true;
            results.push(`Removed: "${removed.text}"`);
          }
          break;
        }
        case 'complete': {
          const index = resolveIndex();
          if (index !== undefined) {
            setItem(index, { ...updatedTodos[index], status: 'completed' });
            results.push(`Completed: "${updatedTodos[index].text}"`);
          }
          break;
        }
        case 'processing': {
          const index = resolveIndex();
          if (index !== undefined) {
            setItem(index, { ...updatedTodos[index], status: 'processing' });
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

    const todoState: TodoState = { items: updatedTodos, updatedAt: now };

    if (!changed) {
      return {
        content: [
          `ℹ️ No change. ${NO_CHANGE_HINT}`,
          skippedSummary,
          formatTodoStateSummary(updatedTodos, now),
        ]
          .filter(Boolean)
          .join('\n\n'),
        state: { todos: todoState },
        success: true,
      };
    }

    const actionSummary = `🔄 Applied ${results.length} operation${results.length > 1 ? 's' : ''}:\n${results.map((r) => `- ${r}`).join('\n')}`;

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

    const paused = await this.pauseIfLooping('clearTodos', context);
    if (paused) return paused;

    const existingTodos = await this.resolveExistingTodos(context);

    if (existingTodos.length === 0) {
      const now = new Date().toISOString();
      return {
        content:
          `Todo list is already empty. ${NO_CHANGE_HINT}\n\n` + formatTodoStateSummary([], now),
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
          ? `No completed items to clear. ${NO_CHANGE_HINT}`
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
