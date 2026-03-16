# Branding Update Design - 2026-03-13

## Overview

Update the application branding from "Lobe AI" to "Loctek AI" and fix the logo loading issue caused by hydration mismatch.

## Requirements

1. Change all "Lobe AI" references to "Loctek AI" in the conversation UI
2. Use Loctek logo (`/loctek_logo.png`) as the AI avatar
3. Fix the hydration mismatch error in the auth layout that prevents proper CSS variable initialization

## Design Details

### 1. AI Name Change: "Lobe AI" → "Loctek AI"

**Primary Change:**

- Update `LOBE_AI_TITLE` constant in `src/features/Conversation/hooks/useAgentMeta.ts` from `'Lobe AI'` to `'Loctek AI'`
- This constant is used for all builtin agents (inbox, page agent, agent builder)

**Secondary Changes:**

- Update hardcoded "Lobe AI" strings in components:
  - `src/routes/(main)/home/_layout/Body/Agent/List/InboxItem.tsx`
  - `src/routes/(mobile)/(home)/features/SessionListContent/Inbox/index.tsx`
  - `src/routes/(mobile)/chat/features/ChatHeader/ChatHeaderTitle.tsx`
  - `src/routes/(main)/group/features/Conversation/AgentWelcome/index.tsx`
  - `src/features/ShareModal/ShareImage/Preview.tsx`

- Update i18n strings in `src/locales/default/`:
  - `plugin.ts` - 'skillInstallBanner.title'
  - `memory.ts` - memory analysis description
  - `hotkey.ts` - 'navigateToChat.desc'

### 2. Avatar Update

**Implementation:**

- The avatar is already returned from the backend via `agentMeta`
- Ensure backend builtin-agents configuration uses `/loctek_logo.png`
- If backend cannot be modified, add logic in `useAgentMeta` to override avatar for builtin agents

**File:** `src/features/Conversation/hooks/useAgentMeta.ts`

### 3. Fix Hydration Mismatch Error

**Root Cause:**

- `AuthThemeLite.tsx` uses `useIsDark()` hook which may return different values on server vs client
- This causes `appearance` and `defaultAppearance` props to differ, resulting in different CSS variable names

**Solution:**

- Add `suppressHydrationWarning` to the `<App>` component
- Ensure theme initialization is consistent between server and client
- Consider using a stable default appearance value

**File:** `src/app/[variants]/(auth)/_layout/AuthThemeLite.tsx`

## Implementation Order

1. Fix hydration mismatch in AuthThemeLite
2. Update AI name constant and all references
3. Update i18n strings
4. Verify avatar is using correct logo

## Testing

- Verify "Loctek AI" appears in all conversation UI locations
- Confirm logo loads without hydration warnings
- Check that builtin agent avatar displays correctly
- Test on both light and dark themes
