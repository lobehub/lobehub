---
name: hotkey
description: 'Use for keyboard shortcuts, registration, key combinations, scope, conflicts and shortcut tooltips.'
user-invocable: false
---

# Adding Keyboard Shortcuts Guide

## Steps to Add a New Hotkey

### 1. Update Hotkey Constant

In `packages/types/src/hotkey.ts`, add the new id to the `HotkeyId` union — it's the source of truth `HotkeyEnum` is typed against:

```typescript
export type HotkeyId =
  | 'addUserMessage'
  // existing...
  | 'saveTopic';
```

### 2. Register Default Hotkey

In `packages/const/src/hotkeys.ts`, `KeyEnum` and `combineKeys` are already defined locally in this file, so no import is needed — add the entry to `HotkeyEnum` and to `HOTKEYS_REGISTRATION`:

```typescript
export const HotkeyEnum = {
  // existing...
  SaveTopic: 'saveTopic',
} as const satisfies Record<string, HotkeyId>;

export const HOTKEYS_REGISTRATION: HotkeyRegistration = [
  // existing...
  {
    group: HotkeyGroupEnum.Conversation,
    id: HotkeyEnum.SaveTopic,
    keys: combineKeys([KeyEnum.Alt, 'n']),
    scopes: [HotkeyScopeEnum.Chat],
  },
];
```

### 3. Add i18n Translation

In `packages/locales/src/default/hotkey.ts`:

```typescript
const hotkey: HotkeyI18nTranslations = {
  saveTopic: {
    desc: '保存当前话题并新建一个话题',
    title: '保存话题',
  },
};
```

### 4. Create and Register Hook

In `src/hooks/useHotkeys/chatScope.ts`:

```typescript
export const useSaveTopicHotkey = () => {
  const openNewTopicOrSaveTopic = useChatStore((s) => s.openNewTopicOrSaveTopic);
  return useHotkeyById(HotkeyEnum.SaveTopic, openNewTopicOrSaveTopic);
};

export const useRegisterChatHotkeys = () => {
  useSaveTopicHotkey();
  // ...other hotkeys
};
```

### 5. Add Tooltip (Optional)

```tsx
const saveTopicHotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.SaveTopic));

<Tooltip hotkey={saveTopicHotkey} title={t('saveTopic.title', { ns: 'hotkey' })}>
  <Button icon={<SaveOutlined />} onClick={openNewTopicOrSaveTopic} />
</Tooltip>;
```

## Best Practices

1. **Scope**: Choose global or chat scope based on functionality
2. **Grouping**: Place in appropriate group (System/Layout/Conversation)
3. **Conflict check**: Ensure no conflict with system/browser shortcuts
4. **Platform**: Use `KeyEnum.Mod` instead of hardcoded `Ctrl` or `Cmd`
5. **Clear description**: Provide title and description for users

## Troubleshooting

- **Not working**: Check scope and RegisterHotkeys hook
- **Not in settings**: Verify HOTKEYS\_REGISTRATION config
- **Conflict**: HotkeyInput component shows warnings
- **Page-specific**: Ensure correct scope activation
