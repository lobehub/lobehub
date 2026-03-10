# Zustand Action Patterns

## Optimistic Update Implementation

### Standard Flow

```typescript
internal_updateMessageContent: async (id, content, extra) => {
  const { internal_dispatchMessage, refreshMessages } = get();

  // 1. Immediately update frontend
  internal_dispatchMessage({
    id,
    type: 'updateMessage',
    value: { content },
  });

  // 2. Call backend
  await messageService.updateMessage(id, { content });

  // 3. Refresh for consistency
  await refreshMessages();
},
```

### Create Operations

```typescript
internal_createMessage: async (message, context) => {
  let tempId = context?.tempMessageId;
  if (!tempId) {
    tempId = internal_createTmpMessage(message);
    internal_toggleMessageLoading(true, tempId);
  }

  try {
    const id = await messageService.createMessage(message);
    await refreshMessages();
    internal_toggleMessageLoading(false, tempId);
    return id;
  } catch (e) {
    internal_toggleMessageLoading(false, tempId);
    internal_dispatchMessage({
      id: tempId,
      type: 'updateMessage',
      value: { error: { type: ChatErrorType.CreateMessageError } },
    });
  }
},
```

### Delete Operations (No Optimistic Update)

```typescript
internal_removeGenerationTopic: async (id: string) => {
  get().internal_updateGenerationTopicLoading(id, true);

  try {
    await generationTopicService.deleteTopic(id);
    await get().refreshGenerationTopics();
  } finally {
    get().internal_updateGenerationTopicLoading(id, false);
  }
},
```

## Loading State Management

```typescript
// Define in initialState.ts
export interface ChatMessageState {
  messageEditingIds: string[];
}

// Manage in action
toggleMessageEditing: (id, editing) => {
  set(
    { messageEditingIds: toggleBooleanList(get().messageEditingIds, id, editing) },
    false,
    'toggleMessageEditing',
  );
};
```

## SWR Integration

```typescript
useFetchMessages: (enable, sessionId, activeTopicId) =>
  useClientDataSWR<ChatMessage[]>(
    enable ? [SWR_USE_FETCH_MESSAGES, sessionId, activeTopicId] : null,
    async ([, sessionId, topicId]) => messageService.getMessages(sessionId, topicId),
    {
      onSuccess: (messages) => {
        const nextMap = { ...get().messagesMap, [messageMapKey(sessionId, activeTopicId)]: messages };
        if (get().messagesInit && isEqual(nextMap, get().messagesMap)) return;
        set({ messagesInit: true, messagesMap: nextMap }, false, n('useFetchMessages'));
      },
    }
  ),

// Cache invalidation
refreshMessages: async () => {
  await mutate([SWR_USE_FETCH_MESSAGES, get().activeId, get().activeTopicId]);
};
```

## Reducer Pattern

```typescript
export const messagesReducer = (state: ChatMessage[], payload: MessageDispatch): ChatMessage[] => {
  switch (payload.type) {
    case 'updateMessage': {
      return produce(state, (draftState) => {
        const index = draftState.findIndex((i) => i.id === payload.id);
        if (index < 0) return;
        draftState[index] = merge(draftState[index], {
          ...payload.value,
          updatedAt: Date.now(),
        });
      });
    }
    // ...other cases
  }
};
```
