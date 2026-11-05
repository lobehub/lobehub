'use client';

import { HotkeyEnum, HotkeyScopeEnum } from '@lobechat/const/hotkeys';
import { useDebounce } from 'ahooks';
import { useCallback, useState } from 'react';

import { useHotkeyById } from '@/hooks/useHotkeys/useHotkeyById';

import TaskFindBar from './TaskFindBar';
import { useTaskFind } from './useTaskFind';

// Matching walks the rendered DOM, no request involved: a short debounce only
// keeps every keystroke of a long word from repainting the page.
const FIND_DEBOUNCE_MS = 120;

/**
 * Find in the task detail. Mod+F reuses the "find" binding the conversation
 * already owns (one key, one meaning: find in what is open), so a rebind in
 * settings moves both, and the two never show up as conflicting shortcuts.
 */
export const useTaskFindBar = () => {
  // A callback ref into state: the scroll container remounts when Retry
  // replaces the error view, and the search must follow the new element.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const keyword = useDebounce(value, { wait: FIND_DEBOUNCE_MS }).trim();
  const { activeIndex, count, step } = useTaskFind({ enabled: open, keyword, root });

  const openFind = useCallback(() => {
    setOpen(true);
    setFocusRequest((nonce) => nonce + 1);
  }, []);
  // Like a browser's find bar, closing keeps the keyword for the next Mod+F.
  const closeFind = useCallback(() => setOpen(false), []);

  useHotkeyById(HotkeyEnum.FindInTopic, openFind, {
    enableOnContentEditable: true,
    enabled: true,
    scopes: [HotkeyScopeEnum.Global],
  });

  const bar = open ? (
    <TaskFindBar
      activeIndex={activeIndex}
      count={count}
      focusRequest={focusRequest}
      settledKeyword={keyword}
      value={value}
      onChange={setValue}
      onClose={closeFind}
      onStep={step}
    />
  ) : null;

  return { bar, openFind, rootRef: setRoot };
};
