/**
 * API names for GTD (Getting Things Done) tool
 *
 * GTD Tools help users and agents manage tasks effectively.
 * These tools can be used by:
 * - LobeAI default assistant for user task management
 * - Group Supervisor for multi-agent task orchestration
 *
 * MVP version focuses on Plan and Todo functionality.
 * Task management will be added in future iterations.
 */
export const GTDApiName = {
  // ==================== Quick Todo ====================
  /** Clear completed or all todos */
  clearTodos: 'clearTodos',

  // ==================== Planning ====================
  /** Create a structured plan by breaking down a goal into actionable steps */
  createPlan: 'createPlan',

  /** Create new todo items */
  createTodos: 'createTodos',

  // ==================== Async Tasks ====================
  /** Execute a single async task */
  execTask: 'execTask',

  /** Execute one or more async tasks */
  execTasks: 'execTasks',

  /** Update an existing plan */
  updatePlan: 'updatePlan',

  /** Update todo items with batch operations (add, update, remove, complete, processing) */
  updateTodos: 'updateTodos',
} as const;

export type GTDApiNameType = (typeof GTDApiName)[keyof typeof GTDApiName];

// ==================== Todo Item ====================

/** Status of a todo item */
export type TodoStatus = 'todo' | 'processing' | 'completed';

export interface TodoItem {
  /** Status of the todo item */
  status: TodoStatus;
  /** The todo item text */
  text: string;
}

/** Get the next status in the cycle: todo → processing → completed → todo */
export const getNextTodoStatus = (current: TodoStatus): TodoStatus => {
  const cycle: TodoStatus[] = ['todo', 'processing', 'completed'];
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length];
};

export interface TodoList {
  items: TodoItem[];
  updatedAt: string;
}

/** Alias for TodoList, used for state storage in Plan metadata */
export type TodoState = TodoList;

// ==================== Todo Params ====================

/**
 * Create new todo items
 * - AI input: { adds: string[] } - array of text strings from AI
 * - After user edit: { items: TodoItem[] } - saved format with TodoItem objects
 */
export interface CreateTodosParams {
  /** Array of text strings from AI */
  adds?: string[];
  /** Array of TodoItem objects (saved format after user edit) */
  items?: TodoItem[];
}

/**
 * Update operation types for batch updates
 */
export type TodoUpdateOperationType = 'add' | 'update' | 'remove' | 'complete' | 'processing';

/**
 * Single update operation
 */
export interface TodoUpdateOperation {
  /** For 'update', 'remove', 'complete', 'processing': the index of the item (0-based) */
  index?: number;
  /** For 'update': the new text */
  newText?: string;
  /** For 'update': the new status */
  status?: TodoStatus;
  /** For 'add': the text to add */
  text?: string;
  /** Operation type */
  type: TodoUpdateOperationType;
}

/**
 * Update todo list with batch operations
 * Supports: add, update, remove, complete, processing
 */
export interface UpdateTodosParams {
  /** Array of update operations to apply */
  operations: TodoUpdateOperation[];
}

/**
 * Clear todo items
 */
export interface ClearTodosParams {
  /** Clear mode: 'completed' only clears done items, 'all' clears everything */
  mode: 'completed' | 'all';
}

// ==================== Todo State Types for Render ====================

export interface CreateTodosState {
  /** Items that were created */
  createdItems: string[];
  /** Current todo list after creation */
  todos: TodoList;
}

export interface UpdateTodosState {
  /** Operations that were applied */
  appliedOperations: TodoUpdateOperation[];
  /** Current todo list after update */
  todos: TodoList;
}

export interface CompleteTodosState {
  /** Indices that were completed */
  completedIndices: number[];
  /** Current todo list after completion */
  todos: TodoList;
}

export interface RemoveTodosState {
  /** Indices that were removed */
  removedIndices: number[];
  /** Current todo list after removal */
  todos: TodoList;
}

export interface ClearTodosState {
  /** Number of items cleared */
  clearedCount: number;
  /** Mode used for clearing */
  mode: 'completed' | 'all';
  /** Current todo list after clearing */
  todos: TodoList;
}

// ==================== Planning Params ====================

/**
 * Create a high-level plan document
 * Plans define the strategic direction (what and why), not actionable steps
 *
 * Field mapping to Document:
 * - goal -> document.title
 * - description -> document.description
 * - context -> document.content
 */
export interface CreatePlanParams {
  /** Detailed context, background, constraints (maps to document.content) */
  context?: string;
  /** Brief summary of the plan (maps to document.description) */
  description: string;
  /** The main goal or objective to achieve (maps to document.title) */
  goal: string;
}

export interface UpdatePlanParams {
  /** Mark plan as completed */
  completed?: boolean;
  /** Updated context (maps to document.content) */
  context?: string;
  /** Updated description (maps to document.description) */
  description?: string;
  /** Updated goal (maps to document.title) */
  goal?: string;
  /** Plan ID to update */
  planId: string;
}

// ==================== Plan Result Types ====================

/**
 * A high-level plan document
 * Contains goal and context, but no steps (steps are managed via Todos)
 *
 * Field mapping to Document:
 * - goal -> document.title
 * - description -> document.description
 * - context -> document.content
 */
export interface Plan {
  /** Whether the plan is completed */
  completed: boolean;
  /** Detailed context, background, constraints (maps to document.content) */
  context?: string;
  /** Creation timestamp */
  createdAt: string;
  /** Brief summary of the plan (maps to document.description) */
  description: string;
  /** The main goal or objective (maps to document.title) */
  goal: string;
  /** Unique plan identifier */
  id: string;
  /** Last update timestamp */
  updatedAt: string;
}

// ==================== Plan State Types for Render ====================

export interface CreatePlanState {
  /** The created plan document */
  plan: Plan;
}

export interface UpdatePlanState {
  /** The updated plan document */
  plan: Plan;
}

// ==================== Async Tasks Types ====================

/**
 * Single task item for execution
 */
export interface ExecTaskItem {
  /** Brief description of what this task does (shown in UI) */
  description: string;
  /** Whether to inherit context messages from parent conversation */
  inheritMessages?: boolean;
  /** Detailed instruction/prompt for the task execution */
  instruction: string;
  /**
   * Whether to execute the task on the client side (desktop only).
   * When true and running on desktop, the task will be executed locally
   * with access to local tools (file system, shell commands, etc.).
   *
   * MUST be true when task requires local-system tools.
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

/**
 * Parameters for execTask API
 * Execute a single async task
 */
export interface ExecTaskParams {
  /** Brief description of what this task does (shown in UI) */
  description: string;
  /** Whether to inherit context messages from parent conversation */
  inheritMessages?: boolean;
  /** Detailed instruction/prompt for the task execution */
  instruction: string;
  /**
   * Whether to execute the task on the client side (desktop only).
   * When true and running on desktop, the task will be executed locally
   * with access to local tools (file system, shell commands, etc.).
   *
   * MUST be true when task requires local-system tools.
   */
  runInClient?: boolean;
  /** Timeout in milliseconds (optional, default 30 minutes) */
  timeout?: number;
}

/**
 * Parameters for execTasks API
 * Execute one or more async tasks
 */
export interface ExecTasksParams {
  /** Array of tasks to execute */
  tasks: ExecTaskItem[];
}

/**
 * State returned after triggering exec_task (server-side)
 */
export interface ExecTaskState {
  /** Parent message ID (tool message) */
  parentMessageId: string;
  /** The task definition that was triggered */
  task: ExecTaskItem;
  /** Type identifier for render component */
  type: 'execTask';
}

/**
 * State returned after triggering exec_tasks (server-side)
 */
export interface ExecTasksState {
  /** Parent message ID (tool message) */
  parentMessageId: string;
  /** Array of task definitions that were triggered */
  tasks: ExecTaskItem[];
  /** Type identifier for render component */
  type: 'execTasks';
}

/**
 * State returned after triggering exec_client_task (client-side, desktop only)
 */
export interface ExecClientTaskState {
  /** Parent message ID (tool message) */
  parentMessageId: string;
  /** The task definition that was triggered */
  task: ExecTaskItem;
  /** Type identifier for render component */
  type: 'execClientTask';
}

/**
 * State returned after triggering exec_client_tasks (client-side, desktop only)
 */
export interface ExecClientTasksState {
  /** Parent message ID (tool message) */
  parentMessageId: string;
  /** Array of task definitions that were triggered */
  tasks: ExecTaskItem[];
  /** Type identifier for render component */
  type: 'execClientTasks';
}
