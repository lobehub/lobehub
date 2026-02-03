---
name: zustand
description: Zustand state management guide. Use when working with store code (src/store/**), implementing actions, managing state, or creating slices. Triggers on Zustand store development, state management questions, or action implementation.
---

# LobeChat Zustand State Management

## Action Type Hierarchy

### 1. Public Actions
Main interfaces for UI components:
- Naming: Verb form (`createTopic`, `sendMessage`)
- Responsibilities: Parameter validation, flow orchestration

### 2. Internal Actions (`internal_*`)
Core business logic implementation:
- Naming: `internal_` prefix (`internal_createTopic`)
- Responsibilities: Optimistic updates, service calls, error handling
- Should not be called directly by UI

### 3. Dispatch Methods (`internal_dispatch*`)
State update handlers:
- Naming: `internal_dispatch` + entity (`internal_dispatchTopic`)
- Responsibilities: Calling reducers, updating store

## When to Use Reducer vs Simple `set`

**Use Reducer Pattern:**
- Managing object lists/maps (`messagesMap`, `topicMaps`)
- Optimistic updates
- Complex state transitions

**Use Simple `set`:**
- Toggling booleans
- Updating simple values
- Setting single state fields

## Optimistic Update Pattern

```typescript
internal_createTopic: async (params) => {
  const tmpId = Date.now().toString();

  // 1. Immediately update frontend (optimistic)
  get().internal_dispatchTopic(
    { type: 'addTopic', value: { ...params, id: tmpId } },
    'internal_createTopic'
  );

  // 2. Call backend service
  const topicId = await topicService.createTopic(params);

  // 3. Refresh for consistency
  await get().refreshTopic();
  return topicId;
},
```

**Delete operations**: Don't use optimistic updates (destructive, complex recovery)

## Naming Conventions

**Actions:**
- Public: `createTopic`, `sendMessage`
- Internal: `internal_createTopic`, `internal_updateMessageContent`
- Dispatch: `internal_dispatchTopic`
- Toggle: `internal_toggleMessageLoading`

**State:**
- ID arrays: `messageLoadingIds`, `topicEditingIds`
- Maps: `topicMaps`, `messagesMap`
- Active: `activeTopicId`
- Init flags: `topicsInit`

## Detailed Guides

- Action patterns: `references/action-patterns.md`
- Slice organization: `references/slice-organization.md`

## Class-Based Action Migration (2026)

We are migrating some slices from `StateCreator` objects to **class-based actions**.

### Pattern
- Define a class that encapsulates actions and receives `(set, get, api)` in the constructor.
- Use `#private` fields (e.g., `#set`, `#get`) to avoid leaking internals when spreading class instances.
- Prefer shared typing helpers:
  - `StoreSetter<T>` from `@/store/types` for `set`.
  - `PublicActions<T>` to hide private fields from action types.
- Export the class from `slices/*` and compose in `action.ts` with `createActionProxy`.

```ts
type PublicActions<T> = { [K in keyof T]: T[K] };

class ChatGroupInternalAction {
  readonly #get: () => ChatGroupState;
  readonly #set: StoreSetter<ChatGroupStore>;
  constructor(set: StoreSetter<ChatGroupStore>, get: () => ChatGroupState, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }
  // ...
}

export type ChatGroupAction = PublicActions<
  ChatGroupInternalAction & ChatGroupLifecycleAction & ChatGroupMemberAction & ChatGroupCurdAction
>;

export const chatGroupAction: StateCreator<ChatGroupStore, [['zustand/devtools', never]], [], ChatGroupAction> =
  (...params) =>
    createActionProxy<ChatGroupAction>([
      new ChatGroupInternalAction(...params),
      new ChatGroupLifecycleAction(...params),
      new ChatGroupMemberAction(...params),
      new ChatGroupCurdAction(...params),
    ]);
```

### Composition
- `action.ts` composes via `createActionProxy` to merge action instances.
- `PublicActions<T>` strips `#private` fields from the exposed action type.

### Store-Access Types
- For class methods that depend on actions in other classes, define explicit store augmentations:
  - `ChatGroupStoreWithSwitchTopic` for lifecycle `switchTopic`
  - `ChatGroupStoreWithRefresh` for member refresh
  - `ChatGroupStoreWithInternal` for curd `internal_dispatchChatGroup`

### Do / Don't
- **Do**: keep constructor signature aligned with `StateCreator` params `(set, get, api)`.
- **Do**: use `#private` to avoid `set/get` being exposed via object spread.
- **Don't**: keep both old slice objects and class actions active at the same time.
