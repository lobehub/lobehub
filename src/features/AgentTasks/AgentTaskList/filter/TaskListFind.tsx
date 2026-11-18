'use client';

import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Icon, Input } from '@lobehub/ui';
import { SearchIcon, XIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@/const/layoutTokens';
import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

import { useTaskListFind } from './useTaskListFind';

interface TaskListFindProps {
  /** The list's `content` filter: what the box shows and edits. */
  content?: string;
  onChange: (content: string) => void;
}

/**
 * "Find in view" of the Tasks page, after Linear: Mod+F opens a search box in
 * the header that narrows the current view by text. It edits the same
 * server-side `content` condition the filter menu offers, so every collection
 * (list, board, scheduled, "My tasks") narrows the same way, and a condition
 * picked from the menu shows here too.
 *
 * Mod+F reuses the "find" binding the conversation and the task detail own
 * (one key, one meaning: find in what is open), so a rebind moves all three.
 */
const TaskListFind = memo<TaskListFindProps>(({ content, onChange }) => {
  const { t } = useTranslation('chat');
  const findHotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.FindInTopic));
  const inputRef = useRef<HTMLInputElement>(null);
  const { blur, clearAndClose, commit, draft, expanded, focus, focusRequest, openFind, setDraft } =
    useTaskListFind({ content, onChange });

  useHotkeyById(HotkeyEnum.FindInTopic, openFind, {
    enableOnContentEditable: true,
    enabled: true,
    scopes: [HotkeyScopeEnum.Global],
  });

  useEffect(() => {
    if (focusRequest === 0) return;
    // The box mounts in the same commit that opens it; focus once it is there.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => clearTimeout(timer);
  }, [focusRequest]);

  const close = () => {
    clearAndClose();
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  };

  if (!expanded) {
    return (
      <ActionIcon
        icon={SearchIcon}
        size={DESKTOP_HEADER_ICON_SMALL_SIZE}
        title={t('taskList.find.open')}
        tooltipProps={{ hotkey: findHotkey, placement: 'bottom' }}
        onClick={openFind}
      />
    );
  }

  return (
    <Input
      aria-label={t('taskList.find.placeholder')}
      data-testid={'task-list-find'}
      placeholder={t('taskList.find.placeholder')}
      prefix={<Icon icon={SearchIcon} size={14} />}
      ref={inputRef}
      size={'small'}
      style={{ width: 220 }}
      value={draft}
      variant={'filled'}
      suffix={
        draft ? (
          <ActionIcon
            icon={XIcon}
            size={'small'}
            title={t('taskList.find.clear')}
            onClick={close}
            // Keep the input focused until the click lands, so its blur does not close first.
            onMouseDown={(event) => event.preventDefault()}
          />
        ) : undefined
      }
      onBlur={blur}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={focus}
      onKeyDown={handleKeyDown}
    />
  );
});

TaskListFind.displayName = 'TaskListFind';

export default TaskListFind;
