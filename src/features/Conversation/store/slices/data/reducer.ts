import {
  type ChatMessageExtra,
  type ChatToolPayload,
  type CreateMessageParams,
  type MessagePluginItem,
  type UIChatMessage,
} from '@lobechat/types';
import isEqual from 'fast-deep-equal';
import { produce } from 'immer';

import { merge } from '@/utils/merge';

// ===== Dispatch Types =====

interface UpdateMessages {
  type: 'updateMessages';
  value: UIChatMessage[];
}

interface UpdateMessage {
  id: string;
  type: 'updateMessage';
  value: Partial<UIChatMessage>;
}

interface CreateMessage {
  id: string;
  type: 'createMessage';
  value: CreateMessageParams;
}

interface DeleteMessage {
  id: string;
  type: 'deleteMessage';
}

interface DeleteMessages {
  ids: string[];
  type: 'deleteMessages';
}

interface UpdatePluginState {
  id: string;
  key: string;
  type: 'updatePluginState';
  value: any;
}

interface UpdateMessagePlugin {
  id: string;
  type: 'updateMessagePlugin';
  value: Partial<MessagePluginItem>;
}

interface UpdateMessageTools {
  id: string;
  tool_call_id: string;
  type: 'updateMessageTools';
  value: Partial<ChatToolPayload>;
}

interface AddMessageTool {
  id: string;
  type: 'addMessageTool';
  value: ChatToolPayload;
}

interface DeleteMessageTool {
  id: string;
  tool_call_id: string;
  type: 'deleteMessageTool';
}

interface UpdateMessageExtra {
  id: string;
  key: string;
  type: 'updateMessageExtra';
  value: any;
}

interface UpdateMessageMetadata {
  id: string;
  type: 'updateMessageMetadata';
  value: Partial<UIChatMessage['metadata']>;
}

interface UpdateMessageGroupMetadata {
  id: string;
  type: 'updateMessageGroupMetadata';
  value: Record<string, unknown>;
}

export type MessageDispatch =
  | CreateMessage
  | UpdateMessage
  | UpdateMessages
  | UpdatePluginState
  | UpdateMessageExtra
  | UpdateMessageMetadata
  | UpdateMessageGroupMetadata
  | DeleteMessage
  | UpdateMessagePlugin
  | UpdateMessageTools
  | AddMessageTool
  | DeleteMessageTool
  | DeleteMessages;

// ===== Reducer =====

/**
 * Message reducer for array-based data structure
 * Operates on UIChatMessage[] to preserve order
 */
export const messagesReducer = (
  state: UIChatMessage[],
  payload: MessageDispatch,
): UIChatMessage[] => {
  switch (payload.type) {
    case 'updateMessage': {
      const { id, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      return produce(state, (draft) => {
        draft[index] = merge(draft[index], { ...value, updatedAt: Date.now() });
      });
    }

    case 'updateMessageExtra': {
      const { id, key, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      return produce(state, (draft) => {
        const message = draft[index];
        if (!message.extra) {
          message.extra = { [key]: value } as ChatMessageExtra;
        } else {
          message.extra[key as keyof ChatMessageExtra] = value;
        }
        message.updatedAt = Date.now();
      });
    }

    case 'updateMessageMetadata': {
      const { id, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      return produce(state, (draft) => {
        const message = draft[index];
        message.metadata = merge(message.metadata, value);
        message.updatedAt = Date.now();
      });
    }

    case 'updatePluginState': {
      const { id, key, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      const message = state[index];
      const newPluginState = message.pluginState
        ? merge(message.pluginState, { [key]: value })
        : { [key]: value };

      // Check if plugin state actually changed
      if (isEqual(message.pluginState, newPluginState)) return state;

      return produce(state, (draft) => {
        draft[index].pluginState = newPluginState;
        draft[index].updatedAt = Date.now();
      });
    }

    case 'updateMessagePlugin': {
      const { id, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      const message = state[index];
      if (message.role !== 'tool') return state;

      return produce(state, (draft) => {
        draft[index].plugin = merge(draft[index].plugin, value);
        draft[index].updatedAt = Date.now();
      });
    }

    case 'addMessageTool': {
      const { id, value } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      const message = state[index];
      if (message.role !== 'assistant') return state;

      const tools = message.tools || [];
      // Check if tool already exists
      if (tools.some((tool) => tool.id === value.id)) return state;

      return produce(state, (draft) => {
        if (!draft[index].tools) {
          draft[index].tools = [value];
        } else {
          draft[index].tools!.push(value);
        }
        draft[index].updatedAt = Date.now();
      });
    }

    case 'deleteMessageTool': {
      const { id, tool_call_id } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      const message = state[index];
      if (message.role !== 'assistant' || !message.tools) return state;

      return produce(state, (draft) => {
        draft[index].tools = draft[index].tools!.filter((tool) => tool.id !== tool_call_id);
        draft[index].updatedAt = Date.now();
      });
    }

    case 'updateMessageTools': {
      const { id, value, tool_call_id } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      const message = state[index];
      if (message.role !== 'assistant' || !message.tools) return state;

      const toolIndex = message.tools.findIndex((tool) => tool.id === tool_call_id);
      if (toolIndex < 0) return state;

      return produce(state, (draft) => {
        draft[index].tools![toolIndex] = merge(draft[index].tools![toolIndex], value);
        draft[index].updatedAt = Date.now();
      });
    }

    case 'createMessage': {
      const { value, id } = payload;
      const now = Date.now();

      return produce(state, (draft) => {
        draft.push({ ...value, createdAt: now, id, updatedAt: now } as UIChatMessage);
      });
    }

    case 'updateMessages': {
      return payload.value;
    }

    case 'deleteMessage': {
      const { id } = payload;
      const index = state.findIndex((m) => m.id === id);
      if (index < 0) return state;

      return produce(state, (draft) => {
        draft.splice(index, 1);
      });
    }

    case 'deleteMessages': {
      const { ids } = payload;
      const deleteSet = new Set(ids);

      // Build parentId map for messages being deleted
      const parentMap = new Map<string, string | null | undefined>();
      for (const msg of state) {
        if (deleteSet.has(msg.id)) {
          parentMap.set(msg.id, msg.parentId);
        }
      }

      // Find final ancestor (first ancestor not in deleteSet)
      const finalAncestorMap = new Map<string, string | null | undefined>();
      const findFinalAncestor = (id: string): string | null | undefined => {
        if (finalAncestorMap.has(id)) return finalAncestorMap.get(id);

        const parentId = parentMap.get(id);
        if (parentId === null || parentId === undefined) {
          finalAncestorMap.set(id, parentId);
          return parentId;
        }

        if (!deleteSet.has(parentId)) {
          finalAncestorMap.set(id, parentId);
          return parentId;
        }

        const ancestor = findFinalAncestor(parentId);
        finalAncestorMap.set(id, ancestor);
        return ancestor;
      };

      for (const id of deleteSet) {
        findFinalAncestor(id);
      }

      // Filter deleted messages and update parentId for remaining messages
      return state
        .filter((msg) => !deleteSet.has(msg.id))
        .map((msg) => {
          if (msg.parentId && deleteSet.has(msg.parentId)) {
            const newParentId = finalAncestorMap.get(msg.parentId);
            // Convert null to undefined to match UIChatMessage type
            return { ...msg, parentId: newParentId ?? undefined };
          }
          return msg;
        });
    }

    default: {
      throw new Error('未实现的 dispatch type，请检查 reducer');
    }
  }
};
