import { produce } from 'immer';

import type { MessageToolCall, MessageToolCallChunk } from '../types';
import { MessageToolCallSchema } from '../types';

export const parseToolCalls = (origin: MessageToolCall[], value: MessageToolCallChunk[]) =>
  produce(origin, (draft) => {
    // if there is no origin, we should parse all the value and set it to draft
    if (draft.length === 0) {
      draft.push(...value.map((item) => MessageToolCallSchema.parse(item)));
      return;
    }

    // if there is origin, we should merge the value to the origin
    value.forEach(({ index, ...item }) => {
      // First, try to find existing tool call by id (more reliable than index for parallel tool calls)
      const existingByIdIndex = item.id ? draft.findIndex((d) => d.id === item.id) : -1;

      if (existingByIdIndex !== -1) {
        // Found existing tool call with same id - merge arguments
        if (item.function?.arguments) {
          draft[existingByIdIndex].function.arguments += item.function.arguments;
        }
      } else if (!draft?.[index]) {
        // No item at this index - insert new tool call
        draft?.splice(index, 0, MessageToolCallSchema.parse(item));
      } else if (item.id && draft[index].id !== item.id) {
        // Different id at same index - this is a new parallel tool call (e.g., from Gemini)
        // Push to end of draft instead of overwriting
        draft.push(MessageToolCallSchema.parse(item));
      } else {
        // Same index and same id (or no id) - merge arguments
        if (item.function?.arguments) {
          draft[index].function.arguments += item.function.arguments;
        }
      }
    });
  });
