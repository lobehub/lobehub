# Zustand Slice Organization

## Top-Level Store Structure

Key aggregation files:

- `src/store/chat/initialState.ts`: Aggregate all slice initial states
- `src/store/chat/store.ts`: Define top-level `ChatStore`, combine all slice actions
- `src/store/chat/selectors.ts`: Export all slice selectors
- `src/store/chat/helpers.ts`: Chat helper functions

## Store Aggregation Pattern

```typescript
// src/store/chat/initialState.ts
import { ChatTopicState, initialTopicState } from './slices/topic/initialState';
import { ChatMessageState, initialMessageState } from './slices/message/initialState';

export type ChatStoreState = ChatTopicState & ChatMessageState & ...

export const initialState: ChatStoreState = {
  ...initialMessageState,
  ...initialTopicState,
  ...
};

// src/store/chat/store.ts
export interface ChatStoreAction
  extends ChatMessageAction, ChatTopicAction, ...

const createStore: StateCreator<ChatStore, [['zustand/devtools', never]]> = (...params) => ({
  ...initialState,
  ...chatMessage(...params),
  ...chatTopic(...params),
});

export const useChatStore = createWithEqualityFn<ChatStore>()(
  subscribeWithSelector(devtools(createStore)),
  shallow
);
```

## Single Slice Structure

```plaintext
src/store/chat/slices/
└── [sliceName]/
    ├── action.ts          # Define actions (or actions/ directory)
    ├── initialState.ts    # State structure and initial values
    ├── reducer.ts         # (Optional) Reducer pattern
    ├── selectors.ts       # Define selectors
    └── index.ts           # (Optional) Re-exports
```

### initialState.ts

```typescript
export interface ChatTopicState {
  activeTopicId?: string;
  topicMaps: Record<string, ChatTopic[]>;
  topicsInit: boolean;
  topicLoadingIds: string[];
}

export const initialTopicState: ChatTopicState = {
  activeTopicId: undefined,
  topicMaps: {},
  topicsInit: false,
  topicLoadingIds: [],
};
```

### selectors.ts

```typescript
const currentTopics = (s: ChatStoreState): ChatTopic[] | undefined => s.topicMaps[s.activeId];

const getTopicById =
  (id: string) =>
  (s: ChatStoreState): ChatTopic | undefined =>
    currentTopics(s)?.find((topic) => topic.id === id);

// Core pattern: Use xxxSelectors aggregate
export const topicSelectors = {
  currentTopics,
  getTopicById,
};
```

## Complex Actions Sub-directory

```plaintext
src/store/chat/slices/aiChat/
├── actions/
│   ├── generateAIChat.ts
│   ├── rag.ts
│   ├── memory.ts
│   └── index.ts
├── initialState.ts
└── selectors.ts
```

## State Design Patterns

### Map Structure for Associated Data

```typescript
topicMaps: Record<string, ChatTopic[]>;
messagesMap: Record<string, ChatMessage[]>;
```

### Arrays for Loading State

```typescript
messageLoadingIds: string[]
topicLoadingIds: string[]
```

### Optional Fields for Active Items

```typescript
activeId: string
activeTopicId?: string
```

## Best Practices

1. **Slice division**: By functional domain (message, topic, aiChat)
2. **File naming**: camelCase for directories, consistent patterns
3. **State structure**: Flat, avoid deep nesting
4. **Type safety**: Clear TypeScript interfaces for each slice
