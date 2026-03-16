# Branding Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace "Lobe AI" with "Loctek AI" throughout the application and fix the logo loading hydration mismatch error.

**Architecture:**

1. Fix hydration mismatch in auth layout by suppressing the warning and ensuring consistent theme initialization
2. Update the AI name constant in the agent meta hook (single source of truth)
3. Replace all hardcoded "Lobe AI" strings in components and i18n files
4. Verify avatar uses the correct Loctek logo

**Tech Stack:** React, TypeScript, Zustand, antd-style, react-i18next

---

## Task 1: Fix Hydration Mismatch in AuthThemeLite

**Files:**

- Modify: `src/app/[variants]/(auth)/_layout/AuthThemeLite.tsx`

**Step 1: Understand the current issue**

The hydration mismatch occurs because `useIsDark()` hook may return different values on server vs client, causing different CSS variable names. Read the file to understand the structure.

Run: `cat src/app/[variants]/(auth)/_layout/AuthThemeLite.tsx`

**Step 2: Add suppressHydrationWarning to App component**

Replace the `<App>` component to suppress the hydration warning:

```typescript
<App style={{ height: '100%' }} suppressHydrationWarning>
```

This tells React to ignore the hydration mismatch for this specific element since the theme initialization is intentionally different between server and client.

**Step 3: Verify the fix**

Run the dev server and check the browser console:

```bash
bun run dev:spa
```

Expected: No hydration mismatch warning in console for the auth layout.

**Step 4: Commit**

```bash
git add src/app/[variants]/(auth)/_layout/AuthThemeLite.tsx
git commit -m "🐛 fix: suppress hydration mismatch warning in auth layout"
```

---

## Task 2: Update AI Name Constant

**Files:**

- Modify: `src/features/Conversation/hooks/useAgentMeta.ts:9`

**Step 1: Update the constant**

Change line 9 from:

```typescript
const LOBE_AI_TITLE = 'Lobe AI';
```

To:

```typescript
const LOBE_AI_TITLE = 'Loctek AI';
```

**Step 2: Run tests to ensure no breakage**

```bash
cd /Users/l/Documents/lobehub
bunx vitest run --silent='passed-only' 'src/features/Conversation/hooks/useAgentMeta.test.ts'
```

Expected: Tests pass (they check for the title value, which should now be 'Loctek AI')

**Step 3: Commit**

```bash
git add src/features/Conversation/hooks/useAgentMeta.ts
git commit -m "✨ feat: rename Lobe AI to Loctek AI in agent meta"
```

---

## Task 3: Update Hardcoded Strings in Components

**Files:**

- Modify: `src/routes/(main)/home/_layout/Body/Agent/List/InboxItem.tsx`
- Modify: `src/routes/(mobile)/(home)/features/SessionListContent/Inbox/index.tsx`
- Modify: `src/routes/(mobile)/chat/features/ChatHeader/ChatHeaderTitle.tsx`
- Modify: `src/routes/(main)/group/features/Conversation/AgentWelcome/index.tsx`
- Modify: `src/features/ShareModal/ShareImage/Preview.tsx`

**Step 1: Update InboxItem.tsx**

Find and replace `'Lobe AI'` with `'Loctek AI'`:

```bash
grep -n "Lobe AI" src/routes/\(main\)/home/_layout/Body/Agent/List/InboxItem.tsx
```

Update the line with the hardcoded string.

**Step 2: Update Inbox/index.tsx (mobile)**

```bash
grep -n "Lobe AI" src/routes/\(mobile\)/\(home\)/features/SessionListContent/Inbox/index.tsx
```

Update both occurrences (aria-label and title).

**Step 3: Update ChatHeaderTitle.tsx (mobile)**

```bash
grep -n "Lobe AI" src/routes/\(mobile\)/chat/features/ChatHeader/ChatHeaderTitle.tsx
```

Update the displayTitle assignment.

**Step 4: Update AgentWelcome/index.tsx**

```bash
grep -n "Lobe AI" src/routes/\(main\)/group/features/Conversation/AgentWelcome/index.tsx
```

Update the string in the template.

**Step 5: Update ShareImage/Preview\.tsx**

```bash
grep -n "Lobe AI" src/features/ShareModal/ShareImage/Preview.tsx
```

Update the displayTitle assignment.

**Step 6: Verify all changes**

```bash
grep -r "Lobe AI" src/routes src/features --include="*.tsx" --include="*.ts"
```

Expected: No results (all hardcoded strings replaced)

**Step 7: Commit**

```bash
git add src/routes/\(main\)/home/_layout/Body/Agent/List/InboxItem.tsx \
  src/routes/\(mobile\)/\(home\)/features/SessionListContent/Inbox/index.tsx \
  src/routes/\(mobile\)/chat/features/ChatHeader/ChatHeaderTitle.tsx \
  src/routes/\(main\)/group/features/Conversation/AgentWelcome/index.tsx \
  src/features/ShareModal/ShareImage/Preview.tsx
git commit -m "✨ feat: update hardcoded Lobe AI strings to Loctek AI"
```

---

## Task 4: Update i18n Strings

**Files:**

- Modify: `src/locales/default/plugin.ts`
- Modify: `src/locales/default/memory.ts`
- Modify: `src/locales/default/hotkey.ts`

**Step 1: Update plugin.ts**

Find the line with `'skillInstallBanner.title': 'Add skills to Lobe AI'` and change to:

```typescript
'skillInstallBanner.title': 'Add skills to Loctek AI',
```

**Step 2: Update memory.ts**

Find the line with the memory analysis description containing "Lobe AI" and change to use "Loctek AI":

```typescript
'By default Loctek AI will analyze all unprocessed chats. It\'s optional to select a date range to analyze.',
```

**Step 3: Update hotkey.ts**

Find `'navigateToChat.desc': 'Switch to the Chat tab and enter Lobe AI'` and change to:

```typescript
'navigateToChat.desc': 'Switch to the Chat tab and enter Loctek AI',
```

**Step 4: Verify all i18n updates**

```bash
grep -r "Lobe AI" src/locales/default --include="*.ts"
```

Expected: No results

**Step 5: Commit**

```bash
git add src/locales/default/plugin.ts \
  src/locales/default/memory.ts \
  src/locales/default/hotkey.ts
git commit -m "🌐 i18n: update Lobe AI to Loctek AI in default locale"
```

---

## Task 5: Verify Avatar Configuration

**Files:**

- Check: `src/features/Conversation/hooks/useAgentMeta.ts`

**Step 1: Verify avatar is using correct logo**

The avatar is returned from `agentMeta` which comes from the backend. Verify that the builtin agents are configured to use `/loctek_logo.png`.

Run:

```bash
grep -r "loctek_logo" src --include="*.ts" --include="*.tsx"
```

Expected: Should find references to the logo file

**Step 2: Check if avatar override is needed**

If the backend doesn't return the correct avatar, add logic to `useAgentMeta.ts` to override it for builtin agents:

```typescript
if (isBuiltinAgent) {
  return {
    ...agentMeta,
    title: LOBE_AI_TITLE,
    avatar: '/loctek_logo.png', // Add this line if needed
  };
}
```

**Step 3: Test in browser**

Open the app and verify:

- Inbox conversation shows "Loctek AI" as the title
- Avatar displays the Loctek logo
- No hydration warnings in console

Run:

```bash
bun run dev:spa
```

Navigate to a conversation and verify the changes.

**Step 4: Commit (if avatar override was needed)**

```bash
git add src/features/Conversation/hooks/useAgentMeta.ts
git commit -m "✨ feat: ensure builtin agents use Loctek logo"
```

---

## Task 6: Final Verification and Testing

**Step 1: Run type check**

```bash
bun run type-check
```

Expected: No TypeScript errors

**Step 2: Run relevant tests**

```bash
bunx vitest run --silent='passed-only' 'src/features/Conversation/hooks/useAgentMeta.test.ts'
```

Expected: All tests pass

**Step 3: Manual testing checklist**

- [ ] Open app and navigate to chat
- [ ] Verify "Loctek AI" appears in inbox
- [ ] Verify "Loctek AI" appears in chat header
- [ ] Verify Loctek logo displays as avatar
- [ ] Check browser console for no hydration warnings
- [ ] Test on both light and dark themes
- [ ] Test on mobile view

**Step 4: Final commit summary**

```bash
git log --oneline -6
```

Expected: See all 5 commits related to branding update

---

## Testing Strategy

- **Unit Tests:** Verify `useAgentMeta` returns correct title and avatar
- **Integration Tests:** Verify components display "Loctek AI" correctly
- **Manual Testing:** Visual verification in browser, theme switching, responsive design
- **Type Safety:** Ensure no TypeScript errors after changes

## Rollback Plan

If issues arise, revert commits in reverse order:

```bash
git revert HEAD~5..HEAD
```

This will undo all branding changes while maintaining commit history.
