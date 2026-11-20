import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

/**
 * In-place title editing: Enter or leaving the field saves, Escape puts the
 * saved title back. A blank or unchanged value saves nothing, and a rejected
 * save shows the saved title again (`save` reports its own failure).
 */
export const useGoalTitleEditor = (title: string, save: (title: string) => Promise<void>) => {
  const [value, setValue] = useState(title);
  // Escape blurs the field too; the save that blur would run must not fire.
  const skipBlurSaveRef = useRef(false);
  // Only the latest save may restore the field: an older one failing must not
  // put its stale title over a newer edit, which a later blur would then save.
  const latestSaveRef = useRef(0);

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = async () => {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    const saveId = ++latestSaveRef.current;
    try {
      await save(next);
    } catch {
      if (saveId === latestSaveRef.current) setValue(title);
    }
  };

  const onBlur = () => {
    if (skipBlurSaveRef.current) {
      skipBlurSaveRef.current = false;
      return;
    }
    void commit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      skipBlurSaveRef.current = true;
      setValue(title);
      event.currentTarget.blur();
    }
  };

  return { onBlur, onKeyDown, setValue, value };
};
