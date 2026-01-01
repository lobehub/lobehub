# CommandMenu Feature Documentation

## Overview

The CommandMenu is a powerful command palette feature inspired by tools like Raycast and VS Code's Command Palette. It provides a unified, keyboard-driven interface for quick navigation, searching, and actions across the entire application.

**Key Library**: Built on top of [`cmdk`](https://github.com/pacocoursey/cmdk) (Command K) by Paco Coursey.

## Architecture

### Core Design Principles

1. **Context-Aware**: Automatically detects the current page/context and shows relevant commands
2. **Modal Navigation**: Uses a page stack system for hierarchical navigation (e.g., Main → Theme)
3. **Multi-Mode**: Supports different modes (default, search, AI chat)
4. **Global State**: Integrated with Zustand store for open/close state management
5. **Portal-Based**: Renders as a portal to `document.body` for proper z-index layering

### File Structure

```plaintext
CommandMenu/
├── index.tsx                    # Main component & orchestration
├── useCommandMenu.ts            # Core hook with business logic
├── types.ts                     # TypeScript type definitions
├── styles.ts                    # antd-style CSS-in-JS styles
│
├── components/
│   ├── CommandInput.tsx         # Search input with context/back navigation
│   └── CommandFooter.tsx        # Keyboard shortcuts help
│
├── MainMenu.tsx                 # Default menu (navigation, settings, etc.)
├── ContextCommands.tsx          # Context-specific commands
├── SearchResults.tsx            # Search result display
├── ChatList.tsx                 # AI chat mode message list
├── ThemeMenu.tsx                # Theme selection submenu
│
└── utils/
    ├── context.ts               # Context detection logic
    └── contextCommands.ts       # Context command definitions
```

## Core Concepts

### 1. Context Detection

The CommandMenu automatically detects what page you're on and shows relevant commands.

**File**: `utils/context.ts`

```typescript
// Supported contexts
type ContextType = 'agent' | 'painting' | 'settings' | 'resource' | 'page';

// Context detection based on pathname
const CONTEXT_CONFIGS: ContextConfig[] = [
  { matcher: /^\/agent\/[^/]+$/, name: 'Agent', type: 'agent' },
  { matcher: /^\/image$/, name: 'Painting', type: 'painting' },
  {
    matcher: /^\/settings(?:\/([^/]+))?/,
    name: 'Settings',
    type: 'settings',
    captureSubPath: true  // Captures sub-route like "profile"
  },
  // ...
];
```

**Example**: When on `/settings/profile`, context is:
```typescript
{
  type: 'settings',
  name: 'Settings',
  subPath: 'profile'
}
```

### 2. Page Stack Navigation

Uses an array-based stack for hierarchical navigation:

```typescript
// State
const [pages, setPages] = useState<string[]>([]);
const page = pages.at(-1); // Current page

// Navigate to submenu
navigateToPage('theme'); // pages = ['theme']

// Navigate deeper
navigateToPage('ai-chat'); // pages = ['theme', 'ai-chat']

// Go back
handleBack(); // pages = ['theme']
```

**Keyboard Shortcuts**:
- `Escape`: Go back one level or close if at root
- `Backspace`: Go back when search is empty

### 3. AI Mode

Special mode for asking AI questions about your work.

**Activation**: Press `Tab` when you have search text (and not already in AI mode)

**Flow**:
1. User types query in search
2. Presses `Tab`
3. Query becomes a user message in chat
4. Page stack pushes `'ai-chat'`
5. Search input switches to AI mode placeholder

**State Management**:
```typescript
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const isAiMode = page === 'ai-chat';

const handleAskAI = () => {
  if (search.trim()) {
    const userMessage = {
      content: search,
      id: Date.now().toString(),
      role: 'user',
    };
    setChatMessages(prev => [...prev, userMessage]);
  }
  setPages([...pages, 'ai-chat']);
};
```

### 4. Search Functionality

**Backend**: Uses tRPC Lambda client to query the search API

**File**: `useCommandMenu.ts:38-51`

```typescript
// Debounced search to reduce API calls
const debouncedSearch = useDebounce(search, { wait: 300 });

// SWR-based search
const { data: searchResults, isLoading: isSearching } = useSWR<SearchResult[]>(
  hasSearch && !isAiMode ? ['search', searchQuery] : null,
  async () => lambdaClient.search.query.query({ query: searchQuery }),
  { revalidateOnFocus: false, revalidateOnReconnect: false }
);
```

**Search Types**:
- `message`: Chat messages (NEW - highest priority in agent context)
- `agent`: AI agents/assistants
- `topic`: Conversation topics/threads
- `file`: Uploaded files/knowledge base

**Display**: Results are grouped by type in `SearchResults.tsx` with priority order: Messages → Topics → Agents → Files

**Context-Aware Priority** (NEW):
- **Agent Context** (`/agent/*`): Messages (10), Topics (5), Agents (3), Files (3)
  - Messages from current agent get 0.5-0.7 relevance (highest priority)
  - Other messages get 1-3 relevance (normal)
- **General Context**: Balanced 5/5/5/5 distribution

### 5. Context Commands

Commands that appear based on current context (e.g., Settings submenu navigation).

**File**: `utils/contextCommands.ts`

```typescript
// Define commands for each context type
export const CONTEXT_COMMANDS: Record<ContextType, ContextCommand[]> = {
  settings: [
    {
      label: 'Profile',
      path: '/settings/profile',
      subPath: 'profile',
      icon: UserCircle,
      keywords: ['profile', 'user', 'account'],
    },
    // ...more settings pages
  ],
  agent: [],  // No context commands for agent pages yet
  // ...
};
```

**Smart Filtering**: Automatically hides the current page from the list
```typescript
// If on /settings/profile, won't show "Profile" in context commands
return commands.filter((cmd) => cmd.subPath !== currentSubPath);
```

## Data Flow

### Opening the Command Menu

```
User presses Cmd+K
  ↓
GlobalStore.updateSystemStatus({ showCommandMenu: true })
  ↓
useCommandMenu hook detects open=true
  ↓
useEffect resets state (pages=[], search='', chatMessages=[])
  ↓
CommandMenu renders via portal to document.body
  ↓
detectContext(pathname) determines current context
  ↓
Renders appropriate menu based on state:
  - No page + no search → MainMenu + ContextCommands
  - No page + has search → MainMenu + SearchResults
  - page='theme' → ThemeMenu
  - page='ai-chat' → ChatList
```

### Search Flow

```
User types in input
  ↓
setSearch(value)
  ↓
useDebounce delays by 300ms
  ↓
SWR key changes to ['search', query]
  ↓
lambdaClient.search.query.query({ query })
  ↓
SearchResults receives results
  ↓
Groups by type (agents/topics/files)
  ↓
Renders with type-specific icons and navigation
```

### Navigation Flow

```
User selects "Settings" command
  ↓
handleNavigate('/settings') called
  ↓
react-router navigate('/settings')
  ↓
closeCommandMenu() → setOpen({ showCommandMenu: false })
  ↓
CommandMenu unmounts
```

## Key Features

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Cmd/Ctrl + K` | Open/Close command menu (global) |
| `Escape` | Go back or close |
| `Backspace` | Go back (when search empty) |
| `Tab` | Enter AI mode (when search has text) |
| `↑/↓` | Navigate items |
| `Enter` | Select item |

### Smart Filtering

The `cmdk` library provides built-in fuzzy filtering:
- Searches across command labels, keywords, and descriptions
- Only active when `shouldFilter={!isAiMode}` (disabled in AI mode)
- Custom value strings for better search relevance (see `SearchResults.tsx:71-78`)

### Body Scroll Lock

```typescript
useEffect(() => {
  if (open) {
    const originalStyle = window.getComputedStyle(document.body).overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalStyle;
    };
  }
}, [open]);
```

### Loading States

Search results show skeleton loaders while fetching:
```typescript
if (isLoading) {
  return (
    <Command.Group heading={t('cmdk.search.searching')}>
      {[1, 2, 3].map((i) => (
        <div className={styles.skeletonItem} key={i}>
          <div className={styles.skeleton} />
          {/* ... */}
        </div>
      ))}
    </Command.Group>
  );
}
```

## Styling

Uses `antd-style` for theme-aware CSS-in-JS:

**Key Patterns**:
1. Uses `token.*` for colors/spacing to support dark mode
2. CSS animations for smooth transitions
3. Responsive sizing with viewport units
4. Flexbox for layouts

**Example**:
```typescript
commandRoot: css`
  width: min(640px, 90vw);
  max-height: min(500px, 70vh);
  background: ${token.colorBgElevated};
  box-shadow: ${token.boxShadowSecondary};

  animation: slide-down 0.12s ease-out;

  @keyframes slide-down {
    from {
      transform: translateY(-20px) scale(0.96);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }
`,
```

## Integration Points

### Global State (Zustand)

```typescript
// src/store/global
interface SystemStatus {
  showCommandMenu: boolean;
  // ...
}

// Usage in hook
const [open, setOpen] = useGlobalStore((s) => [
  s.status.showCommandMenu,
  s.updateSystemStatus
]);
```

### Router Integration

```typescript
import { useLocation, useNavigate } from 'react-router-dom';

const navigate = useNavigate();
const location = useLocation();
const pathname = location.pathname;

const handleNavigate = (path: string) => {
  navigate(path);
  closeCommandMenu();
};
```

### tRPC Search API

```typescript
import { lambdaClient } from '@/libs/trpc/client';

// Call server-side search function
lambdaClient.search.query.query({ query: searchQuery });
```

### i18n (Internationalization)

```typescript
import { useTranslation } from 'react-i18next';

const { t } = useTranslation('common');

// Usage
<Command.Empty>{t('cmdk.noResults')}</Command.Empty>
```

**Translation Keys** (in `src/locales/default/common.ts`):
- `cmdk.searchPlaceholder`
- `cmdk.aiModePlaceholder`
- `cmdk.noResults`
- `cmdk.newAgent`
- `cmdk.settings`
- etc.

## How to Extend

### 1. Add a New Context

**Step 1**: Add context type to `types.ts`:
```typescript
export type ContextType =
  | 'agent'
  | 'painting'
  | 'settings'
  | 'resource'
  | 'page'
  | 'your-new-context'; // Add this
```

**Step 2**: Add detection rule to `utils/context.ts`:
```typescript
const CONTEXT_CONFIGS: ContextConfig[] = [
  // ...existing configs
  {
    matcher: /^\/your-route/,
    name: 'Your Context Name',
    type: 'your-new-context',
    captureSubPath: true, // optional
  },
];
```

**Step 3**: Add commands to `utils/contextCommands.ts`:
```typescript
export const CONTEXT_COMMANDS: Record<ContextType, ContextCommand[]> = {
  // ...
  'your-new-context': [
    {
      label: 'Sub Command',
      path: '/your-route/sub',
      subPath: 'sub',
      icon: YourIcon,
      keywords: ['keyword1', 'keyword2'],
    },
  ],
};
```

### 2. Add a New Menu Page

**Step 1**: Create component (e.g., `YourMenu.tsx`):
```typescript
import { Command } from 'cmdk';
import { memo } from 'react';

interface YourMenuProps {
  onSomething: (value: string) => void;
  styles: any;
}

const YourMenu = memo<YourMenuProps>(({ onSomething, styles }) => {
  return (
    <>
      <Command.Item onSelect={() => onSomething('value1')} value="option-1">
        <YourIcon className={styles.icon} />
        <div className={styles.itemContent}>
          <div className={styles.itemLabel}>Option 1</div>
        </div>
      </Command.Item>
      {/* More items... */}
    </>
  );
});

export default YourMenu;
```

**Step 2**: Add handler to `useCommandMenu.ts`:
```typescript
const handleYourAction = (value: string) => {
  // Do something
  closeCommandMenu();
};

return {
  // ...
  handleYourAction,
};
```

**Step 3**: Render in `index.tsx`:
```typescript
{page === 'your-page' && (
  <YourMenu
    onSomething={handleYourAction}
    styles={styles}
  />
)}
```

**Step 4**: Add navigation to it:
```typescript
// In MainMenu or elsewhere
<Command.Item onSelect={() => navigateToPage('your-page')}>
  Your Page
</Command.Item>
```

### 3. Add a New Main Menu Item

In `MainMenu.tsx`:
```typescript
<Command.Item
  onSelect={() => onNavigate('/your-route')}
  value="your-command keywords here"
>
  <YourIcon className={styles.icon} />
  <div className={styles.itemContent}>
    <div className={styles.itemLabel}>{t('cmdk.yourLabel')}</div>
  </div>
</Command.Item>
```

Remember to:
1. Add translation keys to `src/locales/default/common.ts`
2. Use existing icons from `lucide-react`
3. Follow the existing pattern for consistency

### 4. Modify Search Behavior

Search is handled server-side via tRPC. To modify:

**Backend**: Update `src/server/routers/lambda/search.ts` (or similar)

**Frontend**: Search results display in `SearchResults.tsx`
- Modify `getIcon()` for custom icons
- Modify `handleNavigate()` for custom routing
- Modify `getItemValue()` for search ranking

## Common Patterns

### Command Item Structure

```typescript
<Command.Item
  onSelect={() => handleAction()}
  value="searchable keywords here"
>
  <Icon className={styles.icon} />
  <div className={styles.itemContent}>
    <div className={styles.itemLabel}>Primary Label</div>
  </div>
</Command.Item>
```

### Grouped Commands

```typescript
<Command.Group heading={t('cmdk.groupName')}>
  <Command.Item>...</Command.Item>
  <Command.Item>...</Command.Item>
</Command.Group>
```

### Conditional Rendering

```typescript
{!pathname?.startsWith('/settings') && (
  <Command.Item onSelect={() => onNavigate('/settings')}>
    Settings
  </Command.Item>
)}
```

### External Links

```typescript
<Command.Item
  onSelect={() => onExternalLink('https://example.com')}
>
  External Link
</Command.Item>
```

## Testing Considerations

When testing CommandMenu features:

1. **Context Detection**: Test pathname matching
   ```typescript
   expect(detectContext('/agent/123')).toEqual({ type: 'agent', name: 'Agent' });
   ```

2. **Navigation Stack**: Test page state management
   ```typescript
   navigateToPage('theme');
   expect(pages).toEqual(['theme']);
   handleBack();
   expect(pages).toEqual([]);
   ```

3. **Search Debouncing**: Mock timers or use `vi.advanceTimersByTime(300)`

4. **Portal Rendering**: Use `screen.getByRole('dialog')` or similar

5. **Keyboard Events**: Simulate with `fireEvent.keyDown(element, { key: 'Escape' })`

## Performance Notes

1. **Debounced Search**: 300ms delay prevents excessive API calls
2. **SWR Caching**: Search results cached, no refetch on focus/reconnect
3. **Memoization**: All submenu components use `memo()` to prevent re-renders
4. **Portal**: Renders outside main React tree for better performance
5. **Conditional Rendering**: Only renders when `open && mounted`

## Future Improvements

Potential areas for enhancement:

1. **Recent Commands**: Track and show recently used commands
2. **Custom Shortcuts**: Allow users to assign custom keyboard shortcuts
3. **Command History**: Navigate through previous searches
4. **AI Integration**: Actually connect AI mode to backend chat service
5. **Plugin System**: Allow extensions to register custom commands
6. **Themes**: More theme options beyond light/dark/auto
7. **Search Scoping**: Filter search by type (agents only, files only, etc.)
8. **Workspace-specific**: Different commands per workspace/project

---

## Quick Reference

**Open Menu**: `Cmd/Ctrl + K`

**Main Files**:
- `index.tsx` - Main orchestration
- `useCommandMenu.ts` - Business logic
- `MainMenu.tsx` - Default commands
- `SearchResults.tsx` - Search display
- `utils/context.ts` - Context detection
- `utils/contextCommands.ts` - Context commands

**Key Dependencies**:
- `cmdk` - Command palette primitives
- `react-router-dom` - Navigation
- `zustand` - Global state
- `swr` - Data fetching
- `antd-style` - Styling
- `lucide-react` - Icons

**Related Documentation**:
- [cmdk docs](https://cmdk.paco.me/)
- [Zustand docs](https://zustand-demo.pmnd.rs/)
- [SWR docs](https://swr.vercel.app/)
