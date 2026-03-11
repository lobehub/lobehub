---
name: recent-data
description: Guide for using Recent Data (topics, resources, pages). Use when working with recently accessed items, implementing recent lists, or accessing session store recent data. Triggers on recent data usage or implementation tasks.
user-invocable: false
---

# Recent Data Usage Guide

Recent data (recentTopics, recentResources, recentPages) is stored in session store.

## Initialization

In app top-level (e.g., `RecentHydration.tsx`):

```tsx
import { useInitRecentTopic } from '@/hooks/useInitRecentTopic';
import { useInitRecentResource } from '@/hooks/useInitRecentResource';
import { useInitRecentPage } from '@/hooks/useInitRecentPage';

const App = () => {
  useInitRecentTopic();
  useInitRecentResource();
  useInitRecentPage();
  return <YourComponents />;
};
```

## Usage

### Method 1: Read from Store (Recommended)

```tsx
import { useSessionStore } from '@/store/session';
import { recentSelectors } from '@/store/session/selectors';

const Component = () => {
  const recentTopics = useSessionStore(recentSelectors.recentTopics);
  const isInit = useSessionStore(recentSelectors.isRecentTopicsInit);

  if (!isInit) return <div>Loading...</div>;

  return (
    <div>
      {recentTopics.map((topic) => (
        <div key={topic.id}>{topic.title}</div>
      ))}
    </div>
  );
};
```

### Method 2: Use Hook Return (Single component)

```tsx
const { data: recentTopics, isLoading } = useInitRecentTopic();
```

## Available Selectors

### Recent Topics

```tsx
const recentTopics = useSessionStore(recentSelectors.recentTopics);
// Type: RecentTopic[]

const isInit = useSessionStore(recentSelectors.isRecentTopicsInit);
// Type: boolean
```

**RecentTopic type:**

```typescript
interface RecentTopic {
  agent: {
    avatar: string | null;
    backgroundColor: string | null;
    id: string;
    title: string | null;
  } | null;
  id: string;
  title: string | null;
  updatedAt: Date;
}
```

### Recent Resources

```tsx
const recentResources = useSessionStore(recentSelectors.recentResources);
// Type: FileListItem[]

const isInit = useSessionStore(recentSelectors.isRecentResourcesInit);
```

### Recent Pages

```tsx
const recentPages = useSessionStore(recentSelectors.recentPages);
const isInit = useSessionStore(recentSelectors.isRecentPagesInit);
```

## Features

1. **Auto login detection**: Only loads when user is logged in
2. **Data caching**: Stored in store, no repeated loading
3. **Auto refresh**: SWR refreshes on focus (5-minute interval)
4. **Type safe**: Full TypeScript types

## Best Practices

1. Initialize all recent data at app top-level
2. Use selectors to read from store
3. For multi-component use, prefer Method 1
4. Use selectors for render optimization
