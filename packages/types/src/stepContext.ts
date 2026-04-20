/**
 * Runtime Step Context Types
 *
 * Step Context is computed at the beginning of each Agent Runtime step
 * and injected into Context Engine and Tool Executors.
 *
 * Key principles:
 * 1. Computed by the caller (AgentRuntime), not by Context Engine or Executor
 * 2. Executors read from stepContext, return new state via result.state
 * 3. Replaces the deprecated pluginState passing pattern
 */

/** Status of a todo item */
export type StepContextTodoStatus = 'todo' | 'processing' | 'completed';

/**
 * Todo item structure
 * Duplicated here to avoid circular dependency with builtin-tool-gtd
 */
export interface StepContextTodoItem {
  status: StepContextTodoStatus;
  text: string;
}

/**
 * Todo list structure in step context
 */
export interface StepContextTodos {
  items: StepContextTodoItem[];
  updatedAt: string;
}

/**
 * Activated skill info from activateSkill messages
 */
export interface StepActivatedSkill {
  description?: string;
  id: string;
  name: string;
}

/**
 * Page Editor context for each step
 * Contains the latest XML structure fetched at each step
 */
export interface StepPageEditorContext {
  /**
   * Current XML structure of the page
   * Fetched at the beginning of each step to get latest state
   */
  xml: string;
}

/**
 * Initial Page Editor context
 * Stored at operation initialization and remains constant
 */
export interface InitialPageEditorContext {
  /**
   * Initial markdown content of the page
   */
  markdown: string;
  /**
   * Document metadata
   */
  metadata: {
    charCount?: number;
    lineCount?: number;
    title: string;
  };
  /**
   * Initial XML structure (for reference)
   */
  xml: string;
}

/**
 * User-selected skill context for the current request
 * Captured from slash-menu skill action tags before send
 */
export interface RuntimeSelectedSkill {
  /**
   * Preloaded skill content (markdown instructions).
   * When present, injected directly into user message instead of
   * constructing fake activateSkill tool-call preload messages.
   */
  content?: string;
  /**
   * Skill identifier used by runtime/tooling
   */
  identifier: string;
  /**
   * Human-readable skill name shown in the input UI
   */
  name: string;
}

/**
 * User-selected tool context for the current request
 * Captured from slash-menu tool action tags before send
 */
export interface RuntimeSelectedTool {
  /**
   * Preloaded tool context (systemRole + API descriptions).
   * When present, injected directly into user message instead of relying on
   * LLM to discover/activate the tool at runtime — saves tokens.
   */
  content?: string;
  /**
   * Tool identifier used by runtime/tooling
   */
  identifier: string;
  /**
   * Human-readable tool name shown in the input UI
   */
  name: string;
}

/**
 * Runtime Step Context
 *
 * Contains dynamically computed state that changes between steps.
 * Computed from messages at the beginning of each step.
 *
 * @example
 * ```typescript
 * const stepContext = computeStepContext(state);
 * // Pass to Context Engine
 * messagesEngine.process({ messages, stepContext });
 * // Pass to Executor
 * executor.invoke(params, { stepContext, messageId, ... });
 * ```
 */
export interface RuntimeStepContext {
  /**
   * Activated skills accumulated from activateSkill messages
   * Skills once activated remain active for the rest of the conversation
   */
  activatedSkills?: StepActivatedSkill[];
  /**
   * Activated tool identifiers accumulated from lobe-activator messages
   * Tools once activated remain active for the rest of the conversation
   */
  activatedToolIds?: string[];
  /**
   * Whether there are queued user messages waiting to be processed.
   * When true after tool completion, the agent should finish early
   * so the queued messages can be sent as a new operation.
   */
  hasQueuedMessages?: boolean;
  /**
   * Page Editor context for current step
   * Contains the latest XML structure fetched at each step
   */
  stepPageEditor?: StepPageEditorContext;
  /**
   * Current todo list state
   * Computed from the latest GTD tool message in the conversation
   */
  todos?: StepContextTodos;
}

/**
 * Agent mentioned by the user via @ in the input editor
 */
export interface RuntimeMentionedAgent {
  /** Agent ID */
  id: string;
  /** Agent display name */
  name: string;
}

/**
 * A slim tool manifest injected at runtime by callers (e.g. @mention → callAgent).
 * Structurally compatible with LobeToolManifest from @lobechat/context-engine
 * without requiring a cross-package import.
 */
export interface InjectedToolManifest {
  api: Array<{
    description: string;
    name: string;
    parameters: Record<string, any>;
  }>;
  identifier: string;
  meta: { description?: string; title?: string };
  systemRole?: string;
  type?: 'builtin' | 'default' | 'markdown' | 'mcp' | 'standalone';
}

/**
 * Initial Context
 *
 * Contains state captured at operation initialization.
 * Remains constant throughout the operation lifecycle.
 */
export interface RuntimeInitialContext {
  /**
   * Ad-hoc tool manifests injected by callers for the current request.
   * Merged into the tool resolution output without passing through ToolsEngine.
   * Deduplication: manifests whose identifier already appears in enabledToolIds are skipped.
   */
  injectedManifests?: InjectedToolManifest[];
  /**
   * Agents explicitly @mentioned by the user in the input editor.
   * When present in a non-group conversation, the current agent acts as
   * supervisor and can delegate to the mentioned agents via callAgent.
   */
  mentionedAgents?: RuntimeMentionedAgent[];
  /**
   * Initial Page Editor context
   * Contains markdown content and metadata captured at operation start
   */
  pageEditor?: InitialPageEditorContext;
  /**
   * Skills explicitly selected by the user for the current request
   * This is ephemeral runtime context and is not persisted to chat history
   */
  selectedSkills?: RuntimeSelectedSkill[];
  /**
   * Tools explicitly selected by the user for the current request
   * This constrains the available tools for the current runtime execution
   */
  selectedTools?: RuntimeSelectedTool[];
}
