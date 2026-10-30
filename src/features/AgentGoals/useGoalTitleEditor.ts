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

  useEffect(() => {
    setValue(title);
  }, [title]);

  const commit = async () => {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    try {
      await save(next);
    } catch {
      setValue(title);
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
