---
name: hotkey
description: 'Add or edit LobeHub keyboard shortcuts. Use for HotkeyEnum, HOTKEYS_REGISTRATION, combineKeys, useHotkeyById, tooltip hotkeys, shortcut scope, conflicts, or Cmd/Ctrl key combos.'
user-invocable: false
---

# Adding Keyboard Shortcuts Guide

## Steps to Add a New Hotkey

### 1. Update Hotkey Constant

In `src/types/hotkey.ts`:

```typescript
export const HotkeyEnum = {
  // existing...
  ClearChat: 'clearChat', // Add new
} as const;
```

### 2. Register Default Hotkey

In `src/const/hotkeys.ts`:

```typescript
import { KeyMapEnum as Key, combineKeys } from '@lobehub/ui';

export const HOTKEYS_REGISTRATION: HotkeyRegistration = [
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.ClearChat,
    keys: combineKeys([Key.Mod, Key.Shift, Key.Backspace]),
    scopes: [HotkeyScopeEnum.Chat],
  },
];
```

### 3. Add i18n Translation

In `packages/locales/src/default/hotkey.ts`:

```typescript
const hotkey: HotkeyI18nTranslations = {
  clearChat: {
    desc: '清空当前会话的所有消息记录',
    title: '清空聊天记录',
  },
};
```

### 4. Create and Register Hook

In `src/hooks/useHotkeys/chatScope.ts`:

```typescript
export const useClearChatHotkey = () => {
  const clearMessages = useChatStore((s) => s.clearMessages);
  return useHotkeyById(HotkeyEnum.ClearChat, clearMessages);
};

export const useRegisterChatHotkeys = () => {
  useClearChatHotkey();
  // ...other hotkeys
};
```

### 5. Add Tooltip (Optional)

```tsx
const clearChatHotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.ClearChat));

<Tooltip hotkey={clearChatHotkey} title={t('clearChat.title', { ns: 'hotkey' })}>
  <Button icon={<DeleteOutlined />} onClick={clearMessages} />
</Tooltip>;
```

## Best Practices

1. **Scope**: Choose global or chat scope based on functionality
2. **Grouping**: Place in appropriate group (System/Layout/Conversation)
3. **Conflict check**: Ensure no conflict with system/browser shortcuts
4. **Platform**: Use `Key.Mod` instead of hardcoded `Ctrl` or `Cmd`
5. **Clear description**: Provide title and description for users

## Troubleshooting

- **Not working**: Check scope and RegisterHotkeys hook
- **Not in settings**: Verify HOTKEYS\_REGISTRATION config
- **Conflict**: HotkeyInput component shows warnings
- **Page-specific**: Ensure correct scope activation
