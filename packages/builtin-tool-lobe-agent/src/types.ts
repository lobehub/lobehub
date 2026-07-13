export const LobeAgentIdentifier = 'lobe-agent';

export const LobeAgentApiName = {
  analyzeVisualMedia: 'analyzeVisualMedia',
  askUserQuestion: 'askUserQuestion',
  callSubAgent: 'callSubAgent',
  clearTodos: 'clearTodos',
  createPlan: 'createPlan',
  createTodos: 'createTodos',
  updatePlan: 'updatePlan',
  updateTodos: 'updateTodos',
} as const;

export type LobeAgentApiNameType = (typeof LobeAgentApiName)[keyof typeof LobeAgentApiName];

// ==================== Ask User Question ====================
//
// The ask-user-to-clarify capability is reused from the standalone
// `builtin-tool-user-interaction` package (which still ships independently for
// now). Re-exported here so lobe-agent consumers get the argument types from a
// single import surface while both tools coexist.
export type {
  AskUserQuestionArgs,
  AskUserQuestionItem,
  AskUserQuestionOption,
} from '@lobechat/builtin-tool-user-interaction';

export interface AnalyzeVisualMediaParams {
  question: string;
  refs?: string[];
  urls?: string[];
}

export interface AnalyzeVisualMediaFileSummary {
  id?: string;
  name: string;
  ref: string;
  type: 'image' | 'video';
}

export interface AnalyzeVisualMediaState {
  files?: AnalyzeVisualMediaFileSummary[];
  model?: string;
  provider?: string;
  trigger?: string;
  usage?: unknown;
}

// ==================== Sub-Agent ====================

/**
 * Parameters for callSubAgent API
 * Dispatch a single sub-agent.
 */
export interface CallSubAgentParams {
  description: string;
  inheritMessages?: boolean;
  instruction: string;
  runInClient?: boolean;
  timeout?: number;
}

/** Execution stats reported back by a finished sub-agent run. */
export interface SubAgentRunStats {
  /** Model the sub-agent ran on */
  model?: string;
  /** Total tokens consumed by the sub-agent run */
  totalTokens?: number;
  /** Number of tool calls the sub-agent made */
  totalToolCalls?: number;
}

/**
 * State persisted on the callSubAgent tool message.
 *
 * The sub-agent runs in an isolated Thread via the current runtime; the Render
 * uses `threadId` to open that Thread in the portal, and the stats feed the
 * Inspector row.
 */
export interface CallSubAgentState extends SubAgentRunStats {
  /**
   * Live totals streamed from the running sub-agent, patched into the store in
   * memory only (never persisted). Held in its own key so it can't be mistaken
   * for the authoritative flat stats, which are written exactly once — by the
   * completion bridge — when the run finishes.
   */
  progress?: SubAgentRunStats;
  status?: 'pending' | 'completed' | 'error';
  threadId: string;
}

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
