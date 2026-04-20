import { LobeActivatorIdentifier } from '@lobechat/builtin-tool-activator';
import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import {
  type StepActivatedSkill,
  type StepContextTodos,
  type UIChatMessage,
} from '@lobechat/types';

import { chatHelpers } from '../../../helpers';
import { type ChatStoreState } from '../../../initialState';
import { messageMapKey } from '../../../utils/messageMapKey';

/**
 * DB Message Selectors
 *
 * These selectors access raw messages from dbMessagesMap (database source).
 * Use these selectors when you need to:
 * - Operate on raw message data (create, update, delete)
 * - Access original message structure before processing
 * - Perform data mutations or service calls
 *
 * DO NOT use these for UI rendering - use displayMessage.ts selectors instead.
 */

// ============= Basic DB Message Access ========== //

/**
 * Get the current chat key for accessing dbMessagesMap
 */
export const currentDbChatKey = (s: ChatStoreState) =>
  messageMapKey({ agentId: s.activeAgentId, topicId: s.activeTopicId });

/**
 * Get raw messages from database by key
 */
const getDbMessagesByKey =
  (key: string) =>
  (s: ChatStoreState): UIChatMessage[] => {
    return s.dbMessagesMap[key] || [];
  };

/**
 * Get current active agent's raw messages from database
 */
const activeDbMessages = (s: ChatStoreState): UIChatMessage[] => {
  if (!s.activeAgentId) return [];
  return getDbMessagesByKey(currentDbChatKey(s))(s);
};

// ============= DB Message Queries ========== //

/**
 * Get raw message by ID from database (searches globally across all sessions/topics)
 * This is essential for parallel topic agent runtime where background updates
 * may occur after the user has switched to another chat.
 */
const getDbMessageById = (id: string) => (s: ChatStoreState) => {
  // Search across all messages in dbMessagesMap
  for (const messages of Object.values(s.dbMessagesMap)) {
    const message = chatHelpers.getMessageById(messages, id);
    if (message) return message;
  }
  return undefined;
};

/**
 * Get raw message by tool_call_id from database
 */
export const getDbMessageByToolCallId = (id: string) => (s: ChatStoreState) => {
  const messages = activeDbMessages(s);
  return messages.find((m) => m.tool_call_id === id);
};

/**
 * Get traceId from a message by ID
 */
const getTraceIdByDbMessageId = (id: string) => (s: ChatStoreState) =>
  getDbMessageById(id)(s)?.traceId;

/**
 * Get latest raw message from database
 */
const latestDbMessage = (s: ChatStoreState) => activeDbMessages(s).at(-1);

/**
 * Get latest user message from database
 */
const latestUserMessage = (s: ChatStoreState) => {
  const messages = activeDbMessages(s);

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === 'user') return message;
  }

  return undefined;
};

// ============= DB Message Filtering ========== //

/**
 * Get all tool messages from database
 */
const dbToolMessages = (s: ChatStoreState) => {
  const messages = activeDbMessages(s);
  return messages.filter((m) => m.role === 'tool');
};

/**
 * Get all user messages from database
 */
const dbUserMessages = (s: ChatStoreState) => {
  const messages = activeDbMessages(s);
  return messages.filter((m) => m.role === 'user');
};

/**
 * Get all file attachments from user messages
 */
const dbUserFiles = (s: ChatStoreState) => {
  const userMessages = dbUserMessages(s);
  return userMessages
    .filter((m) => m.fileList && m.fileList.length > 0)
    .flatMap((m) => m.fileList)
    .filter(Boolean);
};

// ============= DB Message Counting ========== //

/**
 * Count messages in a specific thread
 */
const countDbMessagesByThreadId = (id: string) => (s: ChatStoreState) => {
  const messages = activeDbMessages(s).filter((m) => m.threadId === id);
  return messages.length;
};

// ============= DB Message Status ========== //

/**
 * Check if current chat is loaded in dbMessagesMap
 */
const isCurrentDbChatLoaded = (s: ChatStoreState) => !!s.dbMessagesMap[currentDbChatKey(s)];

/**
 * Get inbox active topic raw messages from database
 */
const inboxActiveTopicDbMessages = (state: ChatStoreState) => {
  const activeTopicId = state.activeTopicId;
  const key = messageMapKey({ agentId: 'inbox', topicId: activeTopicId });
  return state.dbMessagesMap[key] || [];
};

// ============= Activated Tools Selectors ========== //

/**
 * Accumulate activated tool identifiers from all lobe-activator messages.
 *
 * Unlike todos (which take the latest snapshot), activated tools are
 * cumulative — once a tool is activated it stays active for the rest
 * of the conversation.
 *
 * @param messages - Array of chat messages to scan
 * @returns Deduplicated array of activated tool identifiers, or undefined if none
 */
export const selectActivatedToolIdsFromMessages = (
  messages: UIChatMessage[],
): string[] | undefined => {
  const ids = new Set<string>();

  for (const msg of messages) {
    if (
      msg.role === 'tool' &&
      (msg.plugin?.identifier === LobeActivatorIdentifier ||
        msg.plugin?.identifier === 'lobe-tools') &&
      msg.pluginState?.activatedTools
    ) {
      const activatedTools = msg.pluginState.activatedTools as Array<{ identifier?: string }>;
      if (Array.isArray(activatedTools)) {
        for (const tool of activatedTools) {
          if (tool.identifier) {
            ids.add(tool.identifier);
          }
        }
      }
    }
  }

  return ids.size > 0 ? [...ids] : undefined;
};

// ============= Activated Skills Selectors ========== //

/**
 * Accumulate activated skills from all activateSkill messages.
 *
 * Skills once activated remain active for the rest of the conversation.
 * Uses skill id as key to deduplicate (later calls update the entry).
 *
 * @param messages - Array of chat messages to scan
 * @returns Array of activated skills, or undefined if none
 */
export const selectActivatedSkillsFromMessages = (
  messages: UIChatMessage[],
): StepActivatedSkill[] | undefined => {
  const skillsMap = new Map<string, StepActivatedSkill>();

  for (const msg of messages) {
    if (
      msg.role === 'tool' &&
      (msg.plugin?.identifier === SkillsIdentifier ||
        msg.plugin?.identifier === LobeActivatorIdentifier ||
        msg.plugin?.identifier === 'lobe-tools') &&
      msg.plugin?.apiName === 'activateSkill' &&
      msg.pluginState?.id &&
      msg.pluginState?.name
    ) {
      const id = msg.pluginState.id as string;
      skillsMap.set(id, {
        description: msg.pluginState.description as string | undefined,
        id,
        name: msg.pluginState.name as string,
      });
    }
  }

  return skillsMap.size > 0 ? [...skillsMap.values()] : undefined;
};

// ============= GTD Todos Selectors ========== //

/**
 * Select the latest todos state from messages array
 *
 * Searches messages in reverse order to find the most recent tool message
 * that carries a `pluginState.todos` payload — regardless of which tool
 * produced it. `pluginState.todos` is treated as a shared contract: GTD
 * writes it via its client state mutation, and heterogeneous agent adapters
 * (Claude Code TodoWrite, future ACP/Codex equivalents) synthesize it onto
 * the tool_result event. Any new producer that honors the shape gets picked
 * up automatically.
 *
 * This is a pure function that can be used for both:
 * - UI display (showing current todos)
 * - Agent runtime step context computation
 *
 * @param messages - Array of chat messages to search
 * @returns The latest todos state or undefined if not found
 */
export const selectTodosFromMessages = (
  messages: UIChatMessage[],
): StepContextTodos | undefined => {
  // Search from newest to oldest
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];

    if (msg.role === 'tool' && msg.pluginState?.todos) {
      const todos = msg.pluginState.todos as { items?: unknown[]; updatedAt?: string };

      // Handle the todos structure: { items: TodoItem[], updatedAt: string }
      if (typeof todos === 'object' && 'items' in todos && Array.isArray(todos.items)) {
        return {
          items: todos.items as StepContextTodos['items'],
          updatedAt: todos.updatedAt || new Date().toISOString(),
        };
      }

      // Legacy format: direct array of TodoItem[]
      if (Array.isArray(todos)) {
        return {
          items: todos as StepContextTodos['items'],
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  return undefined;
};

/**
 * Select todos from the current agent turn only — messages after the last
 * user message. Intended for UI surfaces that should drop a stale/completed
 * todos snapshot the moment a new user turn begins. If no user message exists
 * yet (e.g. initial agent greeting), falls back to the full history.
 *
 * Do NOT use this for agent runtime step context — the runtime must see todos
 * across turns so the agent remembers its plan between user messages.
 */
export const selectCurrentTurnTodosFromMessages = (
  messages: UIChatMessage[],
): StepContextTodos | undefined => {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  const scope = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages;
  return selectTodosFromMessages(scope);
};

/**
 * Get current active chat's todos state from db messages
 */
const getActiveTodos = (s: ChatStoreState): StepContextTodos | undefined => {
  const messages = activeDbMessages(s);
  return selectTodosFromMessages(messages);
};

export const dbMessageSelectors = {
  activeDbMessages,
  countDbMessagesByThreadId,
  currentDbChatKey,
  dbToolMessages,
  dbUserFiles,
  dbUserMessages,
  getActiveTodos,
  getDbMessageById,
  getDbMessageByToolCallId,
  getDbMessagesByKey,
  getTraceIdByDbMessageId,
  inboxActiveTopicDbMessages,
  isCurrentDbChatLoaded,
  latestDbMessage,
  latestUserMessage,
  selectActivatedSkillsFromMessages,
  selectActivatedToolIdsFromMessages,
  selectCurrentTurnTodosFromMessages,
  selectTodosFromMessages,
};
